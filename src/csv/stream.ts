// Streaming CSV read/write. csv-parse + csv-stringify, async-iterable wrappers.
//
// We never materialize the whole file in memory; rows flow through.

import { parse, type Options as ParseOptions } from "csv-parse";
import { stringify } from "csv-stringify";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type Row = Record<string, string>;

/**
 * Stream rows from a CSV file. Yields one object per data row, keyed by header.
 */
export async function* readRows(
  path: string,
  options: ParseOptions = {},
): AsyncIterable<Row> {
  const parser = createReadStream(path).pipe(
    parse({
      columns: true,
      bom: true,
      skip_empty_lines: true,
      relax_quotes: true,
      trim: true,
      ...options,
    }),
  );
  for await (const record of parser) {
    yield record as Row;
  }
}

/**
 * Read only the header row (and not the body). Cheap.
 */
export async function readHeaders(path: string): Promise<string[]> {
  const parser = createReadStream(path).pipe(
    parse({ to_line: 1, bom: true, relax_quotes: true, trim: true }),
  );
  for await (const record of parser) {
    return record as string[];
  }
  return [];
}

/**
 * Stream rows to a CSV file. Caller provides the column order.
 */
export async function writeRows(
  path: string,
  columns: string[],
  rows: AsyncIterable<Row>,
): Promise<void> {
  const stringifier = stringify({ header: true, columns });
  const source = Readable.from(toStream(rows));
  await pipeline(source, stringifier, createWriteStream(path));
}

async function* toStream(rows: AsyncIterable<Row>): AsyncIterable<Row> {
  for await (const row of rows) yield row;
}
