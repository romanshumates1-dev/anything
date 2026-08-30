import sqlModule from '../src/app/api/utils/sql.ts';
const sql = sqlModule.default || sqlModule;

async function verify() {
  const scores = await sql`SELECT COUNT(*) FROM lead_scores`;
  const valuations = await sql`SELECT COUNT(*) FROM property_valuations`;
  const probs = await sql`SELECT COUNT(*) FROM deal_probabilities`;
  const actions = await sql`SELECT COUNT(*) FROM lead_actions WHERE status = 'pending'`;

  console.log('Scores:', scores[0].count);
  console.log('Valuations:', valuations[0].count);
  console.log('Probabilities:', probs[0].count);
  console.log('Actions:', actions[0].count);

  process.exit(0);
}

verify().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
