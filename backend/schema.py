from fastapi import FastAPI, Form   
from pydantic import BaseModel, Field

class ClassificationParams(BaseModel):
    cell: float = Field(default=1.0, gt=0, description="Cell size for the grid")
    window: float = Field(default=18.0, gt=0, description="Window size for local maximum filtering")
    threshold: float = Field(default=0.5, gt=0, description="Threshold for classification")
    slope: float = Field(default=0.15, gt=0, description="Slope for classification")
    scalar: float = Field(default=1.25, gt=0, description="Scalar for classification")
    returns: str = "first, last, intermediate, only"
    count: int = Field(default=10, ge=1)
    allow_extrapolation: bool = Field(default=True, description="Allow extrapolation of points outside the original data range")

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
        chunk_size: int = Form(2_000_000)
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
            chunk_size=chunk_size
        )
