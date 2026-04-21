from pathlib import Path

import laspy
import numpy as np
from fastapi import HTTPException

def classify_tree(
        input_las:Path,
        output_las:Path,
        tree_min_h: float = 3.0,
        chunk_size: int = 2_000_000
) -> None:
    try:
        with laspy.open(input_las) as reader:
            header = reader.header.copy()

            with laspy.open(output_las, mode="w", header=header) as writter:
                for points in reader.chunk_iterator(chunk_size):
                    cls = np.asarray(points.classification).copy()
                    hag = np.asarray(points["HeightAboveGround"])

                    tree_maks = (cls != 2) & (hag >= tree_min_h)
                    cls[tree_maks] = 5
                    points.classification = cls
                    writter.write_points(points)
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "message":"tree classification gabisa",
                "error": str(e)
            }
        )