// One entry point for every tile type: picks the chart, or the data table when the accessibility toggle is on.
import { categoryColors, datasetTable, type DashData, type Tile, type TileResult } from "../../lib/dashboard";
import { CartesianChart } from "./Cartesian";
import { ChartEmpty, DataTable } from "./common";
import { DonutChart } from "./Donut";
import { Heatmap } from "./Heatmap";
import { NumberStat, Ring } from "./Stat";

export { DataTable } from "./common";

export function TileChart({ tile, result, spaces, table, onRow }: { tile: Tile; result: TileResult; spaces: DashData["spaces"]; table?: boolean; onRow?: (id: string) => void }) {
  const { data, error } = result;
  const label = tile.title || tile.type;
  if (error) return <ChartEmpty>{error}</ChartEmpty>;
  if (table) { const t = datasetTable(data); return <DataTable columns={t.columns} rows={t.rows} caption={label} />; }
  if (data.kind === "number") return <NumberStat data={data} />;
  if (data.kind === "ring") return <Ring data={data} label={label} color={tile.colors?.value ? `var(--chart-c${tile.colors.value})` : undefined} />;
  if (data.kind === "rows") {
    if (!data.rows.length) return <ChartEmpty>Nothing to list</ChartEmpty>;
    if (tile.type === "list") return (
      <ul className="chart-list h-full overflow-auto">
        {data.rows.map((r, i) => (
          <li key={r.id ?? i}>
            <button type="button" disabled={!onRow || !r.id} onClick={() => r.id && onRow?.(r.id)} className="flex w-full min-w-0 items-center gap-3 text-start">
              <span dir="auto" className="min-w-0 flex-1 truncate text-ink">{r.cells[0] || "Untitled"}</span>
              {r.cells.slice(1).map((c, j) => <span key={j} dir="auto" className="shrink-0 truncate text-[12px] text-muted">{c}</span>)}
            </button>
          </li>
        ))}
        {data.total > data.rows.length && <li className="text-[12px] text-muted">+{data.total - data.rows.length} more</li>}
      </ul>
    );
    return <DataTable columns={data.columns} rows={data.rows.map((r) => r.cells)} caption={label} />;
  }
  if (tile.type === "table" || tile.type === "list") { const t = datasetTable(data); return <DataTable columns={t.columns} rows={t.rows} caption={label} />; }
  if (tile.type === "donut") return <DonutChart data={data} colors={categoryColors(tile, data.categories, { spaces })} label={label} />;
  if (tile.type === "heatmap") return <Heatmap data={data} label={label} color={data.series.length === 1 && tile.colors?.value ? `var(--chart-c${tile.colors.value})` : undefined} />;
  return <CartesianChart data={data} type={tile.type === "number" || tile.type === "ring" ? "bar" : tile.type} label={label} />;
}
