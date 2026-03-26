/**
 * DATA SHAPE YOU SHOULD SEND:
 * {
 *   startDate: "2026-04-13", // ISO date, should be Monday
 *   lanes: ["BA", "DESIGN", "DEV", "QA"], // row order
 *   constraints: {
 *     windowEndDate: "2026-07-31", // compact window end (inclusive)
 *     maxParallelByType: {
 *       BA: 2,
 *       DESIGN: 2,
 *       DEV: 3,
 *       QA: 2
 *     }
 *   },
 *   tasks: [
 *     // Important: array order is priority (top = highest priority).
 *     {
 *       id: "T-101",            // unique required id
 *       name: "Submissions API",// work item name (same name across phases)
 *       type: "DEV",            // BA | DESIGN | DEV | QA
 *       size: "M",              // XS | S | M | L | XL
 *       dependsOn: ["T-100"],   // array of task IDs
 *       earliestWeek: 0,        // optional non-negative integer
 *       status: "DELIVERY",     // optional: NEW | IN_PROGRESS | DELIVERY | RELEASED | BLOCKED
 *       assignee: "Jason (2d)", // optional
 *       notes: "optional text"  // optional
 *     }
 *   ]
 * }
 */

window.roadmapData = {
  startDate: "2026-03-30",
  lanes: ["BA", "DESIGN", "DEV", "QA"],
  constraints: {
    windowEndDate: "2026-07-31",
    maxParallelByType: {
      BA: 2,
      DESIGN: 2,
      DEV: 3,
      QA: 2
    }
  },
  tasks: [
    // 1) Home loan consolidation (must)
    { id: "OKR-001-DEV", name: "Home loan consolidation", type: "DEV", size: "L",  dependsOn: [],  notes: "Engineering: large." },
    { id: "OKR-001-QA",  name: "Home loan consolidation", type: "QA",  size: "M",  dependsOn: ["OKR-001-DEV"], notes: "QA: medium." },

    // 2) Simpology Integration 2.0 (must)
    { id: "OKR-002-BA",  name: "Simpology Integration 2.0", type: "BA",  size: "M", dependsOn: [],              notes: "MoSCoW: must. BA: medium. Design: n/a. QA: small. HD: What is the unique identifier for Simpology? Broker ID? Federation ID?" },
    { id: "OKR-002-DEV", name: "Simpology Integration 2.0", type: "DEV", size: "M", dependsOn: ["OKR-002-BA"],  notes: "Engineering: medium. Deliver up to 80% data mapping and live back-channel updates." },
    { id: "OKR-002-QA",  name: "Simpology Integration 2.0", type: "QA",  size: "S", dependsOn: ["OKR-002-DEV"], notes: "QA: small." },

    // 3) Conveyancing Uplift Phase 2 (must)
    { id: "OKR-003-BA",  name: "Conveyancing Uplift Phase 2", type: "BA",  size: "M", dependsOn: [],              notes: "MoSCoW: must. BA: medium. Design: n/a. QA: small. Internal-API upgrade; participant-to-role mapping; Customer ID & Group ID; observability/monitoring/event analytics." },
    { id: "OKR-003-DEV", name: "Conveyancing Uplift Phase 2", type: "DEV", size: "M", dependsOn: ["OKR-003-BA"],  notes: "Engineering: medium." },
    { id: "OKR-003-QA",  name: "Conveyancing Uplift Phase 2", type: "QA",  size: "S", dependsOn: ["OKR-003-DEV"], notes: "QA: small." },

    // 4) Customer Initiated Referral (Customer initiated referral) (must)
    { id: "OKR-004-BA",     name: "Customer Initiated Referral", type: "BA",     size: "S",  dependsOn: [],                   notes: "MoSCoW: must. BA: small. Design: small. Engineering: medium. QA: small. Customer initiated referral via QR + form." },
    { id: "OKR-004-DESIGN", name: "Customer Initiated Referral", type: "DESIGN", size: "S",  dependsOn: ["OKR-004-BA"],       notes: "Design: small." },
    { id: "OKR-004-DEV",    name: "Customer Initiated Referral", type: "DEV",    size: "M",  dependsOn: ["OKR-004-DESIGN"],   notes: "Engineering: medium." },
    { id: "OKR-004-QA",     name: "Customer Initiated Referral", type: "QA",     size: "S",  dependsOn: ["OKR-004-DEV"],      notes: "QA: small." },

    // 5) Payment process (must)
    { id: "OKR-005-BA",     name: "Payment process", type: "BA",     size: "S",  dependsOn: [],                   notes: "MoSCoW: must. BA: small. Design: small. Engineering: small. QA: x-small. Decide formal process; capture & tokenise bank details; commission tracking." },
    { id: "OKR-005-DESIGN", name: "Payment process", type: "DESIGN", size: "S",  dependsOn: ["OKR-005-BA"],       notes: "Design: small." },
    { id: "OKR-005-DEV",    name: "Payment process", type: "DEV",    size: "S",  dependsOn: ["OKR-005-DESIGN"],   notes: "Engineering: small." },
    { id: "OKR-005-QA",     name: "Payment process", type: "QA",     size: "XS", dependsOn: ["OKR-005-DEV"],      notes: "QA: x-small." },

    // 6) Admin role re-introduction (simplified) (must)
    { id: "OKR-006-BA",     name: "Admin role re-introduction (simplified)", type: "BA",     size: "S",  dependsOn: [],                   notes: "MoSCoW: must. BA: small. Design: small. Engineering: medium. QA: small. Spike existing build; decide manual vs digitisation; compliance checks; on/offboarding." },
    { id: "OKR-006-DESIGN", name: "Admin role re-introduction (simplified)", type: "DESIGN", size: "S",  dependsOn: ["OKR-006-BA"],       notes: "Design: small." },
    { id: "OKR-006-DEV",    name: "Admin role re-introduction (simplified)", type: "DEV",    size: "M",  dependsOn: ["OKR-006-DESIGN"],   notes: "Engineering: medium." },
    { id: "OKR-006-QA",     name: "Admin role re-introduction (simplified)", type: "QA",     size: "S",  dependsOn: ["OKR-006-DEV"],      notes: "QA: small." },

    // 7) Ability to refresh or update credit files (must)
    { id: "OKR-007-BA",     name: "Ability to refresh or update credit files", type: "BA",     size: "S",  dependsOn: [],                   notes: "MoSCoW: must. BA: small (PM: small). Design: x-small. Engineering: small. QA: x-small. Allow refresh / re-pull credit file in existing application." },
    { id: "OKR-007-DESIGN", name: "Ability to refresh or update credit files", type: "DESIGN", size: "XS", dependsOn: ["OKR-007-BA"],       notes: "Design: x-small." },
    { id: "OKR-007-DEV",    name: "Ability to refresh or update credit files", type: "DEV",    size: "S",  dependsOn: ["OKR-007-DESIGN"],   notes: "Engineering: small." },
    { id: "OKR-007-QA",     name: "Ability to refresh or update credit files", type: "QA",     size: "XS", dependsOn: ["OKR-007-DEV"],      notes: "QA: x-small." }
  ]
};
