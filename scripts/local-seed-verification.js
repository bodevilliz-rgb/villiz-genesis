const EXPECTED_SEEDED_ORGANISATION = Object.freeze({
  id: '00000000-0000-4000-b000-000000000001',
  name: 'Villiz Pixels UK',
});

function verifySeededOrganisation(actual) {
  if (actual.id !== EXPECTED_SEEDED_ORGANISATION.id) {
    return { ok: false, error: `expected organisation ID "${EXPECTED_SEEDED_ORGANISATION.id}", got "${actual.id || '(none)'}"` };
  }
  if (actual.name !== EXPECTED_SEEDED_ORGANISATION.name) {
    return { ok: false, error: `expected organisation "${EXPECTED_SEEDED_ORGANISATION.name}" (${EXPECTED_SEEDED_ORGANISATION.id}), got "${actual.name || '(none)'}"` };
  }
  return { ok: true };
}

module.exports = { EXPECTED_SEEDED_ORGANISATION, verifySeededOrganisation };
