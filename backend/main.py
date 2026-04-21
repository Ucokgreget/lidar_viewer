import shutil
import uuid
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from schema import ClassificationParams
from services.pdal_service import (
    save_upload_file,
    build_pipeline,
    write_pipeline_file,
    run_pdal_pipeline
)
from services.tree_service import classify_tree

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
    if not file.filename.lower().endswith("las"):
        raise HTTPException(status_code=400, detail="file is not las bjirr")
    
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

        return FileResponse(
            path=str(result_path),
            media_type="application/octet-stream",
            filename=f"{Path(file.filename).stem}_classified.las",
            background=BackgroundTask(cleanup_path, job_dir)
        )

    except Exception as e:
        cleanup_path(job_dir)
        raise

    