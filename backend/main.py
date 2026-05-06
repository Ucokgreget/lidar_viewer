#main.py
import shutil
import uuid
import json
import zipfile
from pathlib import Path
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

from schema import ClassificationParams, TreeCountParams
from services.pdal_service import (
    save_upload_file,
    build_pipeline,
    write_pipeline_file,
    run_pdal_pipeline
)
from services.tree_service import classify_tree
from services.count_tree_service import count_tree_centers
from services.potree_converter_service import run_potree_converter, POINTCLOUDS_DIR
import urllib.parse

app= FastAPI(title="LiDAR Classification API") 

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

BASE_DIR = Path(__file__).resolve().parent
JOBS_DIR = BASE_DIR/ "jobs"
JOBS_DIR.mkdir(exist_ok=True)
RESULTS_DIR = BASE_DIR / "classified_results"
RESULTS_DIR.mkdir(exist_ok=True)

def cleanup_path (path:Path) -> None:
    if path.exists():
        shutil.rmtree(path, ignore_errors=True)


def find_classified_las_by_job_id(job_id: str) -> Path:
    matches = sorted(RESULTS_DIR.glob(f"*_{job_id}_classified.las"))
    if not matches:
        raise HTTPException(status_code=404, detail="classified LAS tidak ditemukan")

    return matches[0]

@app.get("/health")
def health():
    return {"status":"ok"}

@app.post("/classify")
async def classify_las(
    file : UploadFile = File(...),
    params: ClassificationParams = Depends(ClassificationParams.as_form),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="file is required")
    if not file.filename.lower().endswith(".las"):
        raise HTTPException(status_code=400, detail="file must be .las")
    
    job_id = str(uuid.uuid4())
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    input_path = job_dir / file.filename
    hag_output = job_dir / "out_ground_hag.las"
    tree_output = job_dir / "out_ground_tree.las"
    pipeline_path = job_dir / "groud_hag.json"
    result_path = RESULTS_DIR / f"{Path(file.filename).stem}_{job_id}_classified.las"

    try:
        save_upload_file(file, input_path)

        pipeline = build_pipeline(
            input_las= input_path,
            output_las= hag_output,
            params= params
        )
        write_pipeline_file(pipeline, pipeline_path)

        run_pdal_pipeline(pipeline_path, cwd=job_dir)

        classify_tree(
            input_las=hag_output,
            output_las=tree_output,
            tree_min_h= params.tree_min_h,
            chunk_size= params.chunk_size,
        )

        shutil.copy2(tree_output, result_path)

        response_payload = {
            "job_id": job_id,
            "input_file": file.filename,
            "classified_filename": result_path.name,
            "classified_download_url": f"/classified-results/{result_path.name}",
            "message": "classification completed",
        }

        return JSONResponse(
            response_payload,
            background=BackgroundTask(cleanup_path, job_dir)
        )

    except Exception:
        cleanup_path(job_dir)
        raise


@app.get("/classified-results/{filename}")
def download_classified(filename: str):
    if Path(filename).name != filename:
        raise HTTPException(status_code=400, detail="invalid filename")

    file_path = RESULTS_DIR / filename
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="classified file not found")

    return FileResponse(
        path=str(file_path),
        media_type="application/octet-stream",
        filename=filename,
    )


@app.post("/convert/{job_id}")
def convert_classified_to_potree(job_id: str):
    classified_path = find_classified_las_by_job_id(job_id)
    output_dir = POINTCLOUDS_DIR / job_id
    
    metadata_path = run_potree_converter(
        input_las=classified_path,
        output_dir=output_dir
    )
    
    job_metadata_path = output_dir / "job.json"

    job_metadata = {
        "job_id": job_id,
        "display_name": output_dir.name,
        "classified_filename": classified_path.name,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    with job_metadata_path.open("w", encoding="utf-8") as f:
        json.dump(job_metadata, f, indent=2)

    viewer_src = f"/pointclouds/{output_dir.name}/metadata.json"
    
    encoded_src = urllib.parse.quote(viewer_src, safe="")
    encoded_job_id = urllib.parse.quote(job_id, safe="")
    
    viewer_url = f"/potree/view?src={encoded_src}&job_id={encoded_job_id}"
    
    return {
        "job_id": job_id,
        "classified_filename": classified_path.name,
        "potree_output_dir": str(output_dir),
        "metadata_path": str(metadata_path),
        "job_metadata_path": str(job_metadata_path),
        "viewer_src": viewer_src,
        "viewer_url": viewer_url,
        "message": "conversion completed"
    }


@app.post("/count-trees/{job_id}")
async def count_trees(
    job_id: str,
    params: TreeCountParams = Depends(TreeCountParams.as_form)
):
    classified_path = find_classified_las_by_job_id(job_id)
    job_dir = JOBS_DIR / f"count_{job_id}"
    job_dir.mkdir(parents=True, exist_ok=True)

    tree_center_csv = job_dir / "tree_centers.csv"
    tree_center_geojson = job_dir / "tree_centers.geojson"
    metadata_json = job_dir / "metadata.json"
    zip_output = RESULTS_DIR / f"{classified_path.stem}_tree_centers.zip"

    try:
        count_result = count_tree_centers(
            input_las=classified_path,
            output_csv=tree_center_csv,
            output_geojson=tree_center_geojson,
            chm_res=params.chm_res,
            min_tree_distance=params.min_tree_distance,
            min_height=params.tree_count_min_h,
            smooth_sigma=params.smooth_sigma,
            chunk_size=params.chunk_size,
            aoi_polygon=params.aoi_polygon,
        )

        count_params = {
            "chm_res": params.chm_res,
            "min_tree_distance": params.min_tree_distance,
            "tree_count_min_h": params.tree_count_min_h,
            "smooth_sigma": params.smooth_sigma,
            "chunk_size": params.chunk_size,
            "aoi_polygon": params.aoi_polygon,
        }

        count_summary = {
            "count": count_result["count"],
            "chm_width": count_result["chm_width"],
            "chm_height": count_result["chm_height"],
            "chm_res": count_result["chm_res"],
        }

        with metadata_json.open("w", encoding="utf-8") as f:
            json.dump(
                {
                    "job_id": job_id,
                    "input_classified_file": str(classified_path),
                    "classified_filename": classified_path.name,
                    "count_result": count_summary,
                    "count_params": count_params,
                    "using_aoi": count_result["using_aoi"],
                    "las_bounds": count_result["las_bounds"],
                    "processing_bounds": count_result["processing_bounds"],
                },
                f,
                indent=4
            )

        with zipfile.ZipFile(zip_output, "w", zipfile.ZIP_DEFLATED) as zipf:
            zipf.write(tree_center_csv, arcname="tree_centers.csv")
            zipf.write(tree_center_geojson, arcname="tree_centers.geojson")
            zipf.write(metadata_json, arcname="metadata.json")

        return FileResponse(
            path=str(zip_output),
            media_type="application/zip",
            filename=zip_output.name,
            background=BackgroundTask(cleanup_path, job_dir)
        )

    except Exception:
        cleanup_path(job_dir)
        raise


@app.post("/count-trees/{job_id}/geojson")
async def count_trees_geojson(
    job_id: str,
    params: TreeCountParams = Depends(TreeCountParams.as_form)
):
    classified_path = find_classified_las_by_job_id(job_id)
    job_dir = JOBS_DIR / f"geojson_{job_id}_{uuid.uuid4()}"
    job_dir.mkdir(parents=True, exist_ok=True)

    tree_center_csv = job_dir / "tree_centers.csv"
    tree_center_geojson = job_dir / "tree_centers.geojson"

    try:
        count_result = count_tree_centers(
            input_las=classified_path,
            output_csv=tree_center_csv,
            output_geojson=tree_center_geojson,
            chm_res=params.chm_res,
            min_tree_distance=params.min_tree_distance,
            min_height=params.tree_count_min_h,
            smooth_sigma=params.smooth_sigma,
            chunk_size=params.chunk_size,
            aoi_polygon=params.aoi_polygon,
            include_centers=True,
        )

        count_params = {
            "chm_res": params.chm_res,
            "min_tree_distance": params.min_tree_distance,
            "tree_count_min_h": params.tree_count_min_h,
            "smooth_sigma": params.smooth_sigma,
            "chunk_size": params.chunk_size,
            "aoi_polygon": params.aoi_polygon,
        }

        count_summary = {
            "count": count_result["count"],
            "chm_width": count_result["chm_width"],
            "chm_height": count_result["chm_height"],
            "chm_res": count_result["chm_res"],
        }

        response_payload = {
            "job_id": job_id,
            "count": count_result["count"],
            "using_aoi": count_result["using_aoi"],
            "geojson": count_result["geojson_data"],
            "count_params": count_params,
            "las_bounds": count_result["las_bounds"],
            "processing_bounds": count_result["processing_bounds"],
            "metadata": {
                "count_result": count_summary,
                "count_params": count_params,
                "las_bounds": count_result["las_bounds"],
                "processing_bounds": count_result["processing_bounds"],
            },
        }

        if params.debug_info:
            tree_centers = count_result.get("tree_centers") or []
            heights = [
                float(center["height"])
                for center in tree_centers
                if center.get("height") is not None
            ]
            response_payload["debug_info"] = {
                "chm_width": count_result["chm_width"],
                "chm_height": count_result["chm_height"],
                "number_of_features": len(tree_centers),
                "min_height_center": min(heights) if heights else None,
                "max_height_center": max(heights) if heights else None,
            }

        return JSONResponse(
            response_payload,
            background=BackgroundTask(cleanup_path, job_dir)
        )
    except Exception:
        cleanup_path(job_dir)
        raise