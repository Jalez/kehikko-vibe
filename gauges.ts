import { describe } from './program.ts'
import { gaugeOf, type Gauge } from './meter.ts'

/**
 * A conversation's gauge, read from its record (program.ts `describe`): one `stat` of its
 * `CURRENT` when nothing changed, one small JSON file read when it did. Never throws: a record that
 * cannot be read is null.
 */
export class Gauges {
  async read(file: string | null): Promise<Gauge | null> {
    if (!file) return null
    const said = await describe(file).catch(() => null)
    return said ? gaugeOf(said.meta) : null
  }
}
