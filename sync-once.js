const sync = require('./api/sync-sheet');

(async () => {
  let code = 200;
  const req = { headers: { authorization: `Bearer ${process.env.CRON_SECRET || ''}` } };
  const res = {
    status(value) { code = value; return this; },
    json(body) {
      console.log(JSON.stringify(body));
      if (code >= 400) process.exitCode = 1;
      return body;
    },
  };
  await sync(req, res);
  if (code >= 400) process.exit(code);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
