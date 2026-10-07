import {DatabaseSync} from 'node:sqlite';

// The same small database interface as the hosted Worker. Batches are atomic.
export function database(path=':memory:'){
  const db=new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec('CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL)');
  // Historical installation migrations must not archive a new user's projects.
  db.prepare('INSERT OR IGNORE INTO settings(name,value) VALUES(?,?)').run('fresh-start-20261005','complete');
  const prepare=(sql,args=[])=>({
    bind(...values){return prepare(sql,values);},
    execute(){const result=db.prepare(sql).run(...args);return {meta:{changes:result.changes}};},
    async run(){return this.execute();},
    async all(){return {results:db.prepare(sql).all(...args)};},
    async first(){return db.prepare(sql).get(...args)||null;}
  });
  return {prepare,async batch(queries){
    db.exec('BEGIN IMMEDIATE');
    try{const results=queries.map(q=>q.execute());db.exec('COMMIT');return results;}
    catch(e){db.exec('ROLLBACK');throw e;}
  },close(){db.close();}};
}
