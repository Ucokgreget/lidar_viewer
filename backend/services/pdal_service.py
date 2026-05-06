##pdal.service.py
import json
import shlex
import subprocess
import os
import shutil
from pathlib import Path
from fastapi import FastAPI, HTTPException, UploadFile, File
from schema import ClassificationParams

PDAL_COMMAND = os.getenv("PDAL_COMMAND", "pdal")

def save_upload_file(upload_file: UploadFile, destination: Path) -> None:
    with destination.open("wb") as buffer:
        shutil.copyfileobj(upload_file.file, buffer)

def build_pipeline(
    input_las: Path,
    output_las: Path,
    params: ClassificationParams
) -> dict:
    return {
        "pipeline": [
            {
                "type": "readers.las",
                "filename": str(input_las)
            },
            {
                "type": "filters.smrf",
                "cell": params.cell,
                "window": params.window,
                "threshold": params.threshold,
                "slope": params.slope,
                "scalar": params.scalar,
                "returns": params.returns,
            },
            {
                "allow_extrapolation": params.allow_extrapolation,
                "count": params.count,
                "type":"filters.hag_delaunay",

            },
            {
                "type": "writers.las",
                "extra_dims":"HeightAboveGround=float32",
                "filename": str(output_las)
            }
        ]
    }

def write_pipeline_file(pipeline: dict, pipeline_path: Path) -> None:
    with pipeline_path.open("w", encoding="utf-8") as f:
        json.dump(pipeline, f, indent=2)

def run_pdal_pipeline(pipeline_path: Path, cwd:Path | None = None) -> None:
    cmd = shlex.split(PDAL_COMMAND) + ["pipeline", str(pipeline_path)]

    try:
        result = subprocess.run(
            cmd,
            cwd=str(cwd) if cwd else None,
            capture_output=True,
            text=True,
            check=True,
        )
        if result.stdout:
            print(result.stdout)
        if result.stderr:
            print(result.stderr)
    except subprocess.CalledProcessError as e:
        raise HTTPException (
            status_code=500,
            detail={
                "message":"pipeline pdal error",
                "stdout":e.stdout,
                "stderr":e.stderr,
                "cmd":cmd
            }
        )