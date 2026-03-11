import laspy
import numpy as np

INP = "OUT_ground_hag.las"
OUT = "OUT_ground_tree.las"
CHUNK = 2_000_000
TREE_MIN_H = 3.0  # meter

with laspy.open(INP) as r:
    hdr = r.header.copy()
    with laspy.open(OUT, "w", header=hdr) as w:
        for pts in r.chunk_iterator(CHUNK):
            cls = np.asarray(pts.classification).copy()
            hag = np.asarray(pts["HeightAboveGround"])  # dimensi dari PDAL

            tree = (cls != 2) & (hag >= TREE_MIN_H)
            cls[tree] = 5

            pts.classification = cls
            w.write_points(pts)

print("Done:", OUT)