import { NextResponse } from "next/server";
import { getSheetValues } from "@/lib/sheets";
import {
  parseArrTab,
  parseAeAttainmentTab,
  parsePipelineTab,
  parsePipelineWowTab,
} from "@/lib/parse";

export const revalidate = 300; // cache for 5 minutes

export async function GET() {
  try {
    const [arrRows, aeRows, pipelineRows, pipelineWowRows] = await Promise.all([
      getSheetValues("ARR & recurring revenue"),
      getSheetValues("AE attainment"),
      getSheetValues("Pipeline"),
      getSheetValues("Pipeline - WoW"),
    ]);

    const arr = parseArrTab(arrRows);
    const aeAttainment = parseAeAttainmentTab(aeRows);
    const pipeline = parsePipelineTab(pipelineRows);
    const pipelineWow = parsePipelineWowTab(pipelineWowRows);

    return NextResponse.json({
      updatedAt: new Date().toISOString(),
      arr,
      aeAttainment,
      pipeline,
      pipelineWow,
    });
  } catch (err) {
    console.error("Dashboard data fetch failed:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
