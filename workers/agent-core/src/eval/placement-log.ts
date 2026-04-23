/**
 * @nano-agent/eval-observability — storage placement evidence logger.
 *
 * Records storage operations so that eval pipelines can verify
 * that data items land in the expected storage tier. The placement
 * log is the primary evidence artifact consumed by the storage-topology
 * calibration seam.
 */

/** A single recorded storage placement operation. */
export interface PlacementEntry {
  readonly dataItem: string;
  readonly storageLayer: string;
  readonly key: string;
  readonly op: "read" | "write" | "delete";
  readonly sizeBytes?: number;
  readonly timestamp: string;
}

/** Summary statistics for a single storage layer. */
export interface PlacementSummaryEntry {
  reads: number;
  writes: number;
  totalBytes: number;
}

/**
 * Append-only log of storage placement operations.
 *
 * Provides recording, lookup by data item, and summary statistics
 * grouped by storage layer.
 */
export class StoragePlacementLog {
  private entries: PlacementEntry[] = [];

  /** Record a placement entry. */
  record(entry: PlacementEntry): void {
    this.entries.push(entry);
  }

  /** Return all recorded entries in recording order. */
  getEntries(): PlacementEntry[] {
    return [...this.entries];
  }

  /** Return all entries for a specific data item. */
  getByDataItem(item: string): PlacementEntry[] {
    return this.entries.filter((e) => e.dataItem === item);
  }

  /**
   * Return per-layer summary statistics.
   *
   * Keys are storage layer names; values contain read count,
   * write count, and total bytes across all operations in that layer.
   */
  getSummary(): Record<string, PlacementSummaryEntry> {
    const summary: Record<string, PlacementSummaryEntry> = {};

    for (const entry of this.entries) {
      let layer = summary[entry.storageLayer];
      if (!layer) {
        layer = { reads: 0, writes: 0, totalBytes: 0 };
        summary[entry.storageLayer] = layer;
      }

      if (entry.op === "read") {
        layer.reads++;
      } else if (entry.op === "write") {
        layer.writes++;
      }
      // "delete" counted in neither reads nor writes

      if (entry.sizeBytes !== undefined) {
        layer.totalBytes += entry.sizeBytes;
      }
    }

    return summary;
  }
}
