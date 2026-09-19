import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Table from 'cli-table3';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import pc from 'picocolors';

export async function memoryCommand(action, query) {
  const config = loadConfig();
  const db = new DatabaseSync(config.server.dbPath);

  switch (action) {
    case 'status': {
      logger.divider();
      console.log(pc.bold(pc.cyan('EIDOLON Memory Engine Status:')));

      const totalRows = db.prepare('SELECT COUNT(*) as count FROM memories').get().count;
      const layerCounts = db
        .prepare('SELECT layer, COUNT(*) as count FROM memories GROUP BY layer')
        .all();

      console.log(`Active Persona: ${config.activePersona || 'None'}`);
      console.log(`Total Persistent Memories: ${totalRows}`);

      const table = new Table({ head: ['Memory Layer', 'Layer Name', 'Entries Count'] });
      table.push(
        ['L0', 'Working Memory Buffer', getCount(layerCounts, 'L0')],
        ['L1', 'Episodic Memory (Events)', getCount(layerCounts, 'L1')],
        ['L2', 'Semantic Memory (Facts)', getCount(layerCounts, 'L2')],
        ['L3', 'World & Timeline States', getCount(layerCounts, 'L3')]
      );
      console.log(table.toString());
      logger.divider();
      break;
    }

    case 'compact': {
      logger.info('Compacting expired facts and pruning low-importance memory entries...');
      db.exec(`
        DELETE FROM memories
        WHERE layer = 'L0' AND created_at < datetime('now', '-7 days');

        DELETE FROM memories
        WHERE importance_score < 0.35 AND layer != 'L3';
      `);
      logger.success('Memory store compaction and garbage collection complete.');
      break;
    }

    case 'export': {
      const outPath = path.join(process.cwd(), `memory_export_${Date.now()}.json`);
      const allMemories = db.prepare('SELECT * FROM memories').all();
      fs.writeFileSync(outPath, JSON.stringify(allMemories, null, 2));
      logger.success(`Exported ${allMemories.length} memory records to ${outPath}`);
      break;
    }

    default:
      logger.error(`Unknown memory action: "${action}". Valid actions: status, compact, export.`);
      break;
  }

  db.close();
}

function getCount(rows, layer) {
  const found = rows.find((r) => r.layer === layer);
  return found ? found.count : 0;
}
