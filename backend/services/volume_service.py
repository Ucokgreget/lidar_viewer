from pathlib import Path
from typing import Optional

import laspy
import numpy as np
from scipy.interpolate import griddata
from scipy.ndimage import gaussian_filter
from fastapi import HTTPException

from .count_tree_service import(
    _parse_aoi_polygon,
    _bounds_from_polygon,
    _bounds_overlap,
    _points_in_polygon
)

MAX_GROUND_POINTS_FOR_INTERP=500_000

def compute_stockpile_volume(
    input_las:           Path,
    resolution:          float = 0.5,
    smooth_sigma:        float = 0.5,
    chunk_size:          int=2_000_000,
    aoi_polygon:         Optional[str] = None,
    ground_buffer_ratio: float = 0.15
) -> dict:
    """    
    Menghitung volume stockpile menggunakan metode Cut & Fill.

    Volume = Σ max(DSM - DTM, 0) x cell_area

    DSM  → max Z seluruh point dalam AOI (permukaan stockpile).
    DTM  → interpolasi Z dari ground points class 2 (permukaan tanah asli).
    """
    try:    
        polygon = _parse_aoi_polygon(aoi_polygon)
        using_aoi = polygon is not None

        with laspy.open(input_las) as reader:
            header = reader.header

            las_bounds = {
                "xmin": float(header.mins[0]),
                "ymin": float(header.mins[1]),
                "xmax": float(header.maxs[0]),
                "ymax": float(header.maxs[1])
            }

            if using_aoi:
                aoi_bounds = _bounds_from_polygon(polygon)
                if not _bounds_overlap(las_bounds,aoi_bounds):
                    raise HTTPException(
                        status_code=400,
                        detail={
                            "message":"AOI tidak overlaps dengan LAS",
                            "aoi_bounds": aoi_bounds,
                            "las_bounds":las_bounds
                        }
                    )
                processing_bound = {
                    "xmin": max(las_bounds["xmin"], aoi_bounds["xmin"]),
                    "ymin": max(las_bounds["ymin"], aoi_bounds["ymin"]),
                    "xmax": min(las_bounds["xmax"], aoi_bounds["xmax"]),
                    "ymax": min(las_bounds["ymax"], aoi_bounds["ymax"])
                }
            else:
                aoi_bounds=None
                processing_bound=las_bounds

            xmin = processing_bound["xmin"]
            ymin = processing_bound["ymin"]
            xmax = processing_bound["xmax"]
            ymax = processing_bound["ymax"] 

            width = int(np.ceil((xmax-xmin) / resolution)) + 1
            height = int(np.ceil((ymax-ymin) / resolution)) + 1

            if width * height >= 200_000_000:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "message" : "Area terlalu besar. Naikkan resolusi atau perkecil AOI",
                        "width": width,
                        "height": height
                    }
                )

            span_x = xmax - xmin
            span_y = ymax - ymin

            buf = max(span_x, span_y) * ground_buffer_ratio

            ground_xmin = max(las_bounds["xmin"], xmin - buf)
            ground_ymin = max(las_bounds["ymin"], ymin - buf)
            ground_xmax = min(las_bounds["xmax"], xmax + buf)
            ground_ymax = min(las_bounds["ymax"], ymax + buf)

            dsm = np.full((height, width), -np.inf, dtype=np.float32)

            ground_x_list: list[np.ndarray] = []
            ground_y_list: list[np.ndarray] = []
            ground_z_list: list[np.ndarray] = []

            for points in reader.chunk_iterator(chunk_size):
                cls = np.asarray(points.classification)
                x = np.asarray(points.x, dtype=np.float64)
                y = np.asarray(points.y, dtype=np.float64)
                z = np.asarray(points.z, dtype=np.float64)

                #DSM nih
                in_proc = (
                    (x >= xmin) & (x <= xmax) & 
                    (y >= ymin) & (y <= ymax)
                )

                if np.any(in_proc):
                    xd, yd, zd = x[in_proc], y[in_proc], z[in_proc]
                    if using_aoi:
                        inside = _points_in_polygon(xd, yd, polygon)
                        xd, yd, zd = xd[inside], yd[inside], zd[inside]
                    if len(xd):
                        cols = ((xd-xmin) / resolution).astype(np.int32)
                        rows = ((yd - ymin) / resolution).astype(np.int32)
                        valid = (rows >= 0) & (rows < height) & (cols >= 0) & (cols < width)
                        np.maximum.at(dsm, (rows[valid], cols[valid]), zd[valid])
                
                #DTM nih (ground points class 2)

                gm = (
                    (cls == 2) &
                    (x >= ground_xmin) & (x <= ground_xmax) &
                    (y >= ground_ymin) & (y <= ground_ymax) 
                )
                if np.any(gm):
                    ground_x_list.append(x[gm])
                    ground_y_list.append(y[gm])
                    ground_z_list.append(z[gm].astype(np.float64))
            
        if not ground_x_list:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Tidak ada ground class 2 yang terdeteksi"
                    "Pastikan udah lewat /classify dulu yaa"
                )
            )
        
        gx = np.concatenate(ground_x_list)
        gy = np.concatenate(ground_y_list)
        gz = np.concatenate(ground_z_list)

        if len(gx) > MAX_GROUND_POINTS_FOR_INTERP:
            rng = np.random.default_rng(seed=42)
            idx = rng.choice(len(gx), MAX_GROUND_POINTS_FOR_INTERP, replace=False)
            gx, gy, gz = gx[idx], gy[idx], gz[idx]
        
        #
        col_idx = np.arange(width)
        row_idx = np.arange(height)
        gc, gr = np.meshgrid(col_idx, row_idx)
        grid_x = (xmin + gc * resolution).ravel()
        grid_y = (ymin + gr * resolution).ravel()
        query = np.column_stack([grid_x,grid_y])
        src = np.column_stack([gx, gy])

        #Interpolasi linear, lalu isi NaN tapi dengan nearest
        dtm_linear = griddata(src, gz, query, method="linear").reshape(height, width)
        nan_mask = np.isnan(dtm_linear)
        if np.any(nan_mask):
            dtm_nearest = griddata(src, gz, query, method="nearest").reshape(height, width)
            dtm_linear[nan_mask] = dtm_nearest[nan_mask]
        
        dtm = dtm_linear.astype(np.float32)


        #smoothing dsm
        no_data = dsm == -np.inf
        dsm[no_data] = dtm[no_data]

        if smooth_sigma > 0:
            dsm = gaussian_filter(dsm, sigma=smooth_sigma)
        
        #hitung volume
        diff = dsm - dtm
        cell_area = resolution ** 2

        valid_cells = ~no_data

        # Cut
        cut_mask = (diff > 0) & valid_cells
        cut_volume = float(np.sum(diff[cut_mask] * cell_area))

        #Fill
        fill_mask = (diff < 0) & valid_cells
        fill_volume = float(np.sum(-diff[fill_mask] * cell_area))
        
        #hitung stockpile
        stockpile_area = float(np.sum(cut_mask) * cell_area)
        total_aoi_area = float(np.sum(valid_cells) * cell_area)

        cut_heights= diff[cut_mask]
        max_heigt = float(np.max(cut_heights)) if cut_heights.size else 0.0
        avg_height = float(np.average(cut_heights)) if cut_heights.size else 0.0

        return {
            "volume_cut_m3" : round(cut_volume, 3),
            "volume_fill_m3" : round(fill_volume, 3),
            "net_volume_m3" : round(cut_volume - fill_volume, 3),
            "stockpile_area_m2" : round(stockpile_area, 2),
            "total_aoi_area_m2" : round(total_aoi_area, 2),
            "max_height_m": round(max_heigt, 3),
            "avg_height_m" : round(avg_height, 3),
            "resolution" : resolution,
            "smooth_sigma" : smooth_sigma,
            "grid_width" : width,
            "grid_height" : height,
            "ground_points_used" : int(len(gx)),
            "using_aoi": using_aoi,
            "las_bounds":las_bounds,
            "processing_bounds": processing_bound
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
                status_code=500,
                detail={"message":"error saat itung volume","error":str(e)}
        )