#schema.py
from typing import Optional

from fastapi import Form   
from pydantic import BaseModel, Field

class ClassificationParams(BaseModel):
    # PDAL SMRF params
    cell: float = Field(default=1.0, gt=0, description="Cell size for the grid")
    window: float = Field(default=18.0, gt=0, description="Window size for local maximum filtering")
    threshold: float = Field(default=0.5, gt=0, description="Threshold for classification")
    slope: float = Field(default=0.15, gt=0, description="Slope for classification")
    scalar: float = Field(default=1.25, gt=0, description="Scalar for classification")
    returns: str = "first, last, intermediate, only"

    #HAG params
    count: int = Field(default=10, ge=1)
    allow_extrapolation: bool = Field(default=True, description="Allow extrapolation of points outside the original data range")

    # Tree classification params
    tree_min_h: float = Field(default=3.0, ge=0, description="Minimum height for tree classification")
    chunk_size: int = Field(default=2_000_000, ge=1, description="Chunk size for processing LAS files")



    @classmethod
    def as_form (
        cls,
        cell: float = Form(1.0),
        window: float = Form(18.0),
        threshold: float = Form(0.5),
        slope: float = Form(0.15),
        scalar: float = Form(1.25),
        returns: str = Form("first, last, intermediate, only"),
        count: int = Form(10),
        allow_extrapolation: bool = Form(True),
        tree_min_h: float = Form(3.0),
        chunk_size: int = Form(2_000_000),
    
    ) -> "ClassificationParams":
        return cls(
            cell=cell,
            window=window,
            threshold=threshold,
            slope=slope,
            scalar=scalar,
            returns=returns,
            count=count,
            allow_extrapolation=allow_extrapolation,
            tree_min_h=tree_min_h,
            chunk_size=chunk_size,
        )

class TreeCountParams(BaseModel):
    chm_res: float = Field(
        default=0.5,
        gt=0,
        description="CHM grid resolution in meters"
    )
    min_tree_distance: float = Field(
        default=6.0,
        gt=0,
        description="Minimum distance between detected tree centers in meters"
    )
    tree_count_min_h: float = Field(
        default=3.0,
        ge=0,
        description="Minimum CHM height used for tree center detection"
    )
    smooth_sigma: float = Field(
        default=1.0,
        ge=0,
        description="Gaussian smoothing sigma for CHM"
    )
    chunk_size: int = Field(
        default=2_000_000,
        ge=1,
        description="Chunk size for processing LAS files"
    )
    aoi_polygon: Optional[str] = Field(
        default=None,
        description="AOI polygon as JSON string: [[x1,y1],[x2,y2],[x3,y3]]"
    )
    debug_info: bool = Field(
        default=False,
        description="Include debug info (CHM size, feature count, min/max height)"
    )

    @classmethod
    def as_form(
        cls,
        chm_res: float = Form(0.5),
        min_tree_distance: float = Form(6.0),
        tree_count_min_h: float = Form(3.0),
        smooth_sigma: float = Form(1.0),
        chunk_size: int = Form(2_000_000),
        aoi_polygon: Optional[str] = Form(None),
        debug_info: bool = Form(False),
    ) -> "TreeCountParams":
        return cls(
            chm_res=chm_res,
            min_tree_distance=min_tree_distance,
            tree_count_min_h=tree_count_min_h,
            smooth_sigma=smooth_sigma,
            chunk_size=chunk_size,
            aoi_polygon=aoi_polygon,
            debug_info=debug_info,
        )
