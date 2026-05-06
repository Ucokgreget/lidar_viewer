import os
import shlex
import shutil
import subprocess
from pathlib import Path

from fastapi import HTTPException

DEFAULT_POTREE_CONVERTER = (
    "/home/luqman/Documents/potree/potree/frontend-lidar/backend/"
    "PotreeConverter_2.1.1_x64_linux/PotreeConverter_linux_x64/PotreeConverter"
)

POTREE_CONVERTER_COMMAND = os.getenv(
    "POTREE_CONVERTER_COMMAND",
    DEFAULT_POTREE_CONVERTER,
)

POINTCLOUDS_DIR = Path(
    os.getenv("POINTCLOUDS_DIR", "../frontend/public/pointclouds")
).resolve()

POINTCLOUDS_DIR.mkdir(parents=True, exist_ok=True)


def run_potree_converter(input_las: Path, output_dir: Path) -> Path:
    if not input_las.exists():
        raise HTTPException(status_code=404, detail=f"Input LAS file not found: {input_las}")

    if output_dir.exists():
        shutil.rmtree(output_dir, ignore_errors=True)
    
    output_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        POTREE_CONVERTER_COMMAND,
        str(input_las),
        "-o",
        str(output_dir)
    ]

    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=True
        )
    except subprocess.CalledProcessError as e:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "PotreeConverter failed",
                "cmd": shlex.join(cmd),
                "stdout": e.stdout,
                "stderr": e.stderr,
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Failed to run PotreeConverter",
                "cmd": shlex.join(cmd),
                "error": str(e)
            }
        )

    metadata_path = output_dir / "metadata.json"
    if not metadata_path.exists():
        raise HTTPException(
            status_code=500,
            detail=f"PotreeConverter finished but metadata.json not found in {output_dir}"
        )

    return metadata_path
