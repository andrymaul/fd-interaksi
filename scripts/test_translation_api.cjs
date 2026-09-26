async function testScenarios() {
  const cases = [
    { name: 'Simvastatin + Clarithromycin', drugs: ['simvastatin', 'clarithromycin'], diseases: [] },
    { name: 'Lisinopril + Spironolactone', drugs: ['lisinopril', 'spironolactone'], diseases: ['hyperkalemia'] },
    { name: 'Aspirin + Warfarin', drugs: ['aspirin', 'warfarin'], diseases: ['peptic-ulcer'] }
  ];

  for (const c of cases) {
    console.log(`\n========================================`);
    console.log(`CASE: ${c.name}`);
    console.log(`========================================`);
    const res = await fetch('http://localhost:3001/api/interactions/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drugIds: c.drugs, diseaseIds: c.diseases, noCache: true })
    });
    const d = await res.json();
    console.log('Risk Level:', d.riskLevel, '| Score:', d.riskScore);
    if (d.drugInteractions?.length > 0) {
      console.log('--- DDI ---');
      console.log('Pair:', d.drugInteractions[0].drugA.name, '<->', d.drugInteractions[0].drugB.name);
      console.log('Severity:', d.drugInteractions[0].severity);
      console.log('Mekanisme (ID):', d.drugInteractions[0].mechanism);
      console.log('Manajemen (ID):', d.drugInteractions[0].management);
    }
    if (d.foodInteractions?.length > 0) {
      console.log('--- DFI ---');
      console.log('Food:', d.foodInteractions[0].foodItem, '| Rec:', d.foodInteractions[0].recommendation);
    }
    if (d.diseaseInteractions?.length > 0) {
      console.log('--- DDSI ---');
      console.log('Disease:', d.diseaseInteractions[0].diseaseName);
      console.log('Risk (ID):', d.diseaseInteractions[0].risk);
      console.log('Mgmt (ID):', d.diseaseInteractions[0].management);
    }
  }
}

testScenarios();
