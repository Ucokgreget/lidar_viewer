import subprocess

input_las = "20251212105617000.las"
output_las = "OUT_ground_hag.las"

cmd = [
    "pdal", "pipeline", "ground_hag.json",
    f"--readers.las.filename={input_las}",
    f"--writers.las.filename={output_las}",
]

subprocess.run(cmd, check=True)