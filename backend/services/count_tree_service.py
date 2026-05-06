#count_tree_service.py
from pathlib import Path
import csv
import json
from typing import Optional

import laspy
import numpy as np
from scipy.ndimage import gaussian_filter
from skimage.feature import peak_local_max
from fastapi import HTTPException


def _parse_aoi_polygon(aoi_polygon: Optional[str]) -> Optional[np.ndarray]:
    if not aoi_polygon:
        return None

    try:
        raw = json.loads(aoi_polygon)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "message": "aoi_polygon harus JSON array koordinat",
                "example": "[[x1, y1], [x2, y2], [x3, y3]]",
                "error": str(exc),
            },
        )

    if not isinstance(raw, list) or len(raw) < 3:
        raise HTTPException(
            status_code=400,
            detail="aoi_polygon minimal 3 titik",
        )

    coords = []
    for point in raw:
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            raise HTTPException(
                status_code=400,
                detail="aoi_polygon harus berupa list [x, y]",
            )

        try:
            x = float(point[0])
            y = float(point[1])
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=400,
                detail="aoi_polygon berisi koordinat non-numeric",
            )

        if not np.isfinite(x) or not np.isfinite(y):
            raise HTTPException(
                status_code=400,
                detail="aoi_polygon berisi koordinat tidak valid",
            )

        coords.append((x, y))

    if len(coords) < 3:
        raise HTTPException(
            status_code=400,
            detail="aoi_polygon minimal 3 titik",
        )

    return np.asarray(coords, dtype=np.float64)


def _bounds_from_polygon(polygon: np.ndarray) -> dict:
    return {
        "xmin": float(np.min(polygon[:, 0])),
        "ymin": float(np.min(polygon[:, 1])),
        "xmax": float(np.max(polygon[:, 0])),
        "ymax": float(np.max(polygon[:, 1])),
    }


def _bounds_overlap(a: dict, b: dict) -> bool:
    return not (
        a["xmax"] < b["xmin"]
        or a["xmin"] > b["xmax"]
        or a["ymax"] < b["ymin"]
        or a["ymin"] > b["ymax"]
    )


def _points_in_polygon(x: np.ndarray, y: np.ndarray, polygon: np.ndarray) -> np.ndarray:
    poly_x = polygon[:, 0]
    poly_y = polygon[:, 1]
    n = len(polygon)
    inside = np.zeros_like(x, dtype=bool)
    j = n - 1

    for i in range(n):
        xi = poly_x[i]
        yi = poly_y[i]
        xj = poly_x[j]
        yj = poly_y[j]

        intersects = ((yi > y) != (yj > y)) & (
            x < (xj - xi) * (y - yi) / ((yj - yi) + 1e-12) + xi
        )
        inside ^= intersects
        j = i

    return inside


def build_tree_centers_geojson(tree_centers: list[dict]) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [center["x"], center["y"], center["z"]],
                },
                "properties": {
                    "id": center["id"],
                    "height": center["height"],
                },
            }
            for center in tree_centers
        ],
    }


def write_tree_centers_geojson(output_geojson: Path, tree_centers: list[dict]) -> dict:
    output_geojson.parent.mkdir(parents=True, exist_ok=True)
    geojson_data = build_tree_centers_geojson(tree_centers)

    with output_geojson.open("w", encoding="utf-8") as f:
        json.dump(geojson_data, f, indent=2)

    return geojson_data


def count_tree_centers(
    input_las: Path,
    output_csv: Path,
    output_geojson: Path,
    chm_res: float = 0.5,
    min_tree_distance: float = 6.0,
    min_height: float = 3.0,
    smooth_sigma: float = 1.0,
    chunk_size: int = 2_000_000,
    aoi_polygon: Optional[str] = None,
    include_centers: bool = False,
) -> dict:
    try:
        polygon = _parse_aoi_polygon(aoi_polygon)
        using_aoi = polygon is not None

        with laspy.open(input_las) as reader:
            header = reader.header
            dimension_names = list(header.point_format.dimension_names)

            if "HeightAboveGround" not in dimension_names:
                raise HTTPException(
                    status_code=400,
                    detail="LAS belum punya HeightAboveGround. Jalankan /classify dulu.",
                )

            las_bounds = {
                "xmin": float(header.mins[0]),
                "ymin": float(header.mins[1]),
                "xmax": float(header.maxs[0]),
                "ymax": float(header.maxs[1]),
            }

            aoi_bounds = None
            if using_aoi:
                aoi_bounds = _bounds_from_polygon(polygon)

                if not _bounds_overlap(las_bounds, aoi_bounds):
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "message": "AOI tidak overlap dengan LAS bounds",
                            "las_bounds": las_bounds,
                            "aoi_bounds": aoi_bounds,
                        },
                    )

                processing_bounds = {
                    "xmin": max(las_bounds["xmin"], aoi_bounds["xmin"]),
                    "ymin": max(las_bounds["ymin"], aoi_bounds["ymin"]),
                    "xmax": min(las_bounds["xmax"], aoi_bounds["xmax"]),
                    "ymax": min(las_bounds["ymax"], aoi_bounds["ymax"]),
                }
            else:
                processing_bounds = las_bounds

            xmin = processing_bounds["xmin"]
            ymin = processing_bounds["ymin"]
            xmax = processing_bounds["xmax"]
            ymax = processing_bounds["ymax"]

            width = int(np.ceil((xmax - xmin) / chm_res)) + 1
            height = int(np.ceil((ymax - ymin) / chm_res)) + 1

            total_cells = width * height

            if total_cells > 200_000_000:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "message": "Area terlalu besar untuk CHM sekali proses",
                        "width": width,
                        "height": height,
                        "total_cells": total_cells,
                        "suggestion": "Naikkan chm_res atau proses per tile",
                    },
                )

            chm_hag = np.full((height, width), -np.inf, dtype=np.float32)
            chm_z = np.full((height, width), -np.inf, dtype=np.float32)

            for points in reader.chunk_iterator(chunk_size):
                cls = np.asarray(points.classification)
                hag = np.asarray(points["HeightAboveGround"], dtype=np.float32)

                # class 5 = vegetation/tree dari proses /classify
                mask = (cls == 5) & np.isfinite(hag) & (hag >= min_height)

                if not np.any(mask):
                    continue

                x = np.asarray(points.x)[mask]
                y = np.asarray(points.y)[mask]
                z = np.asarray(points.z)[mask]
                h = hag[mask]

                in_bounds = (x >= xmin) & (x <= xmax) & (y >= ymin) & (y <= ymax)
                if not np.any(in_bounds):
                    continue

                x = x[in_bounds]
                y = y[in_bounds]
                z = z[in_bounds]
                h = h[in_bounds]

                if using_aoi:
                    inside = _points_in_polygon(x, y, polygon)
                    if not np.any(inside):
                        continue

                    x = x[inside]
                    y = y[inside]
                    z = z[inside]
                    h = h[inside]

                cols = ((x - xmin) / chm_res).astype(np.int32)
                rows = ((y - ymin) / chm_res).astype(np.int32)

                valid = (
                    (rows >= 0) & (rows < height) &
                    (cols >= 0) & (cols < width)
                )

                rows = rows[valid]
                cols = cols[valid]
                z = z[valid]
                h = h[valid]

                np.maximum.at(chm_hag, (rows, cols), h)
                np.maximum.at(chm_z, (rows, cols), z)

        chm_hag[chm_hag == -np.inf] = 0.0
        chm_z[chm_z == -np.inf] = 0.0

        chm_smooth = gaussian_filter(chm_hag, sigma=smooth_sigma)

        min_distance_px = max(1, int(min_tree_distance / chm_res))

        peaks = peak_local_max(
            chm_smooth,
            min_distance=min_distance_px,
            threshold_abs=min_height,
            exclude_border=False,
        )

        tree_centers = []

        for idx, (row, col) in enumerate(peaks, start=1):
            x = xmin + col * chm_res
            y = ymin + row * chm_res
            z = float(chm_z[row, col])
            tree_height = float(chm_hag[row, col])

            tree_centers.append({
                "id": idx,
                "x": float(x),
                "y": float(y),
                "z": z,
                "height": tree_height,
            })

        output_csv.parent.mkdir(parents=True, exist_ok=True)

        with output_csv.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(
                f,
                fieldnames=["id", "x", "y", "z", "height"]
            )
            writer.writeheader()
            writer.writerows(tree_centers)

        geojson_data = write_tree_centers_geojson(output_geojson, tree_centers)

        result = {
            "count": len(tree_centers),
            "csv": str(output_csv),
            "geojson": str(output_geojson),
            "chm_width": width,
            "chm_height": height,
            "chm_res": chm_res,
            "min_tree_distance": min_tree_distance,
            "min_height": min_height,
            "smooth_sigma": smooth_sigma,
            "chunk_size": chunk_size,
            "using_aoi": using_aoi,
            "las_bounds": las_bounds,
            "processing_bounds": processing_bounds,
            "aoi_bounds": aoi_bounds,
        }

        if include_centers:
            result["tree_centers"] = tree_centers
            result["geojson_data"] = geojson_data

        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "Error saat menghitung pusat pohon",
                "error": str(e)
            }
        )
