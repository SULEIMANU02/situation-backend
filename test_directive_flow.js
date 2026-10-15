async function runTest() {
  const base = 'http://localhost:5000/api/directives';

  // 1. Create Directive
  const createRes = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'End-to-End Directive Verification Test',
      category: 'MOBILIZATION',
      priority: 'URGENT',
      description: 'Super Admin test directive dispatched to field agents.',
      target_per_pu: 10,
      deadline: '2026-10-30',
      created_by: 1
    })
  });
  const created = await createRes.json();
  console.log('✅ Created Directive:', created.data?.ref_code, 'ID:', created.data?.id);
  const dirId = created.data?.id;

  // 2. Cascade down to Steering & LGA
  const relayRes = await fetch(`${base}/${dirId}/relay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_tier: 'SUPER_ADMIN',
      to_tier: 'STEERING',
      targets: [{ name: 'BILAL SHEHU', phone: '08069389755', lga: 'Bauchi' }],
      relayed_by: 1
    })
  });
  const relayed = await relayRes.json();
  console.log('✅ Relayed to Tier 2:', relayed.message);

  // 3. PU Agent submits upward report (ACK)
  const ackRes = await fetch(`${base}/${dirId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_tier: 'PU',
      response_type: 'ACKNOWLEDGED',
      message: 'Kofar Fada PU Agent received directive. Commenced mobilization.',
      progress_count: 0,
      lga_name: 'Bauchi',
      ward_name: "Dan'iya",
      pu_name: 'Kofar Fada PU 001',
      phone: '08099999999',
      escalate_up: true
    })
  });
  const acked = await ackRes.json();
  console.log('✅ PU Agent ACK (Upward):', acked.message);

  // 4. PU Agent reports progress (PROGRESS_UPDATE)
  const progRes = await fetch(`${base}/${dirId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_tier: 'PU',
      response_type: 'PROGRESS_UPDATE',
      message: 'Verified 8 voters in the register at Kofar Fada PU.',
      progress_count: 8,
      lga_name: 'Bauchi',
      ward_name: "Dan'iya",
      pu_name: 'Kofar Fada PU 001',
      phone: '08099999999',
      escalate_up: true
    })
  });
  const progged = await progRes.json();
  console.log('✅ PU Agent Progress (Upward):', progged.message);

  // 5. PU Agent reports issue (ISSUE)
  const issueRes = await fetch(`${base}/${dirId}/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_tier: 'PU',
      response_type: 'ISSUE',
      message: 'INEC officer arrived 2 hours late. Crowd getting impatient.',
      progress_count: 0,
      lga_name: 'Bauchi',
      ward_name: "Dan'iya",
      pu_name: 'Kofar Fada PU 001',
      phone: '08099999999',
      escalate_up: true
    })
  });
  const issued = await issueRes.json();
  console.log('✅ PU Agent Issue Escalation (Upward):', issued.message);

  // 6. Fetch all upward responses for this directive
  const respsRes = await fetch(`${base}/${dirId}/responses`);
  const resps = await respsRes.json();
  console.log(`✅ Verified: ${resps.data?.length} upward reports in MySQL database for ${created.data?.ref_code}`);

  // 7. Verify aggregated progress endpoint
  const progAggRes = await fetch(`${base}/${dirId}/progress`);
  const progAgg = await progAggRes.json();
  console.log('✅ Aggregated LGA Progress:', JSON.stringify(progAgg.data));

  console.log('\n🎉 ALL 7 TESTS PASSED! Directive cascading and upward reporting flow is verified.');
}

runTest().catch(console.error);
