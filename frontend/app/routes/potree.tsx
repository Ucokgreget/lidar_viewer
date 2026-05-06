//routes/potree.tsx
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Link, useLoaderData } from "react-router";

type PointcloudEntry = {
  name: string;
  url: string;
  type: "metadata" | "ept" | "potree" | "file";
  jobId?: string;
  displayName?: string;
};

type JobMetadata = {
  job_id?: string;
  display_name?: string;
  classified_filename?: string;
};

async function readJobMetadata(dirPath: string): Promise<JobMetadata | null> {
  try {
    const raw = await readFile(path.join(dirPath, "job.json"), "utf-8");
    const parsed = JSON.parse(raw) as JobMetadata;

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

const DIRECTORY_MARKERS = [
  { file: "metadata.json", type: "metadata" as const },
  { file: "ept.json", type: "ept" as const },
  { file: "cloud.js", type: "potree" as const },
];

function labelForType(type: PointcloudEntry["type"]): string {
  switch (type) {
    case "metadata":
      return "Metadata";
    case "ept":
      return "EPT";
    case "potree":
      return "Potree";
    default:
      return "File";
  }
}

export async function loader() {
  const pointcloudRoot = path.join(process.cwd(), "public", "pointclouds");
  const entries: PointcloudEntry[] = [];

  let topLevel;
  try {
    topLevel = await readdir(pointcloudRoot, { withFileTypes: true });
  } catch {
    return { entries };
  }

  for (const entry of topLevel) {
    if (entry.name.startsWith(".")) continue;

    if (entry.isDirectory()) {
      const dirPath = path.join(pointcloudRoot, entry.name);
      const names = new Set(await readdir(dirPath));
      const jobMetadata = await readJobMetadata(dirPath);

      for (const marker of DIRECTORY_MARKERS) {
        if (names.has(marker.file)) {
          entries.push({
            name: jobMetadata?.display_name || entry.name,
            displayName: jobMetadata?.display_name,
            url: `/pointclouds/${entry.name}/${marker.file}`,
            type: marker.type,
            jobId: jobMetadata?.job_id,
          });
          break;
        }
      }

      continue;
    }

    if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (lower.endsWith(".las") || lower.endsWith(".laz")) {
        entries.push({
          name: entry.name,
          url: `/pointclouds/${entry.name}`,
          type: "file",
        });
      }
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  return { entries };
}

export default function PotreeListPage() {
  const { entries } = useLoaderData<typeof loader>();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f2f2f2",
        padding: "24px",
        fontFamily: "'Trebuchet MS', 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "920px",
          margin: "0 auto",
          background: "#ececec",
          border: "2px solid #2f2f2f",
          borderRadius: "20px",
          padding: "20px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "20px",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              padding: "8px 14px",
              border: "2px solid #2f2f2f",
              borderRadius: "10px",
              fontWeight: 700,
            }}
          >
            List LiDAR
          </div>
          <div style={{ color: "#2f2f2f", fontSize: "0.92rem" }}>
            Klik item untuk buka viewer
          </div>
        </div>

        {entries.length === 0 ? (
          <div
            style={{
              padding: "18px",
              border: "2px dashed #666",
              borderRadius: "12px",
              background: "#f8f8f8",
            }}
          >
            Belum ada point cloud converter di folder public/pointclouds.
          </div>
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            {entries.map((entry) => {
              const searchParams = new URLSearchParams();
              searchParams.set("src", entry.url);

              if (entry.jobId) {
                searchParams.set("job_id", entry.jobId);
              }

              const url = `/potree/view?${searchParams.toString()}`;

              return (
                <Link
                  key={entry.url}
                  to={url}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "14px 16px",
                    border: "2px solid #2f2f2f",
                    borderRadius: "12px",
                    background: "#f6f6f6",
                    textDecoration: "none",
                    color: "#1f1f1f",
                  }}
                >
                  <span style={{ fontWeight: 700 }}>
                    {entry.displayName || entry.name}
                  </span>

                  <span style={{ opacity: 0.75, fontSize: "0.82rem" }}>
                    {entry.jobId ? "Linked Job · " : ""}
                    {labelForType(entry.type)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "24px",
          }}
        >
          <Link
            to="/"
            style={{
              padding: "10px 14px",
              border: "2px solid #2f2f2f",
              borderRadius: "10px",
              textDecoration: "none",
              color: "#1f1f1f",
              fontWeight: 700,
            }}
          >
            Kembali
          </Link>
        </div>
      </div>
    </div>
  );
}
