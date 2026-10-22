const res = await fetch('https://firestore.googleapis.com/v1/projects/dotify-11e01/databases/(default)/documents/upgrade_requests');
const data = await res.json();
console.log('Status:', res.status);
if (!data.documents) {
  console.log('No upgrade requests found or error:', data);
  process.exit(0);
}

for (const doc of data.documents) {
  console.log('--- Document:', doc.name.split('/').pop());
  const f = doc.fields || {};
  const summary = {};
  for (const [k, v] of Object.entries(f)) {
    summary[k] = v.stringValue || v.integerValue || v.booleanValue || (v.arrayValue ? `Array(${v.arrayValue.values?.length || 0})` : v);
  }
  console.log(JSON.stringify(summary, null, 2));
}
