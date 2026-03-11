import laspy

INP = "OUT_ground_hag.las"

with laspy.open(INP) as r:
    pts = next(r.chunk_iterator(1))
    dims = list(pts.point_format.dimension_names)

print("All dims:", dims)

cand = [d for d in dims if ("Above" in d) or ("HAG" in d) or ("Height" in d)]
print("Candidates:", cand)