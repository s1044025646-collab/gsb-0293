import { openDb } from './db';
import { serve } from './api';
import { runCli } from './cli';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const db = openDb();
  if (argv[0] === 'serve') {
    const i = argv.indexOf('--port');
    const port = i >= 0 ? Number(argv[i + 1]) : Number(process.env.PORT ?? 0);
    await serve(db, Number.isInteger(port) && port >= 0 ? port : 0);
    return; // 保持进程存活
  }
  try {
    const code = runCli(db, argv);
    db.close();
    process.exit(code);
  } catch (e: any) {
    const msg = e?.code ? `${e.code}: ${e.message}` : String(e?.message ?? e);
    console.error(`错误: ${msg}`);
    process.exit(2);
  }
}

void main();
