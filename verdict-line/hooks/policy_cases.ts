export const CASES = 
[
 {
  "name": "all rules on, everything satisfied -> PASS NET",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "cost_gate: costs_applied false -> GROSS, blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": false,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "GROSS",
   "blocked_by": [
    "cost_gate"
   ]
  }
 },
 {
  "name": "cost_gate: costs_applied absent -> GROSS, blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": null,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "GROSS",
   "blocked_by": [
    "cost_gate"
   ]
  }
 },
 {
  "name": "cost_gate: rt_pts below measured floor -> GROSS, blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 0.5,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "GROSS",
   "blocked_by": [
    "cost_gate"
   ]
  }
 },
 {
  "name": "cost_gate: rt_pts equal to floor -> NET",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 0.9,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "cost_gate: MNQ symbol case-insensitive at floor -> NET",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "mnq",
    "rt_pts": 0.9,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "cost_gate: open session floor 2.5, rt 1.0 -> GROSS, blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured",
    "session": "open"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "GROSS",
   "blocked_by": [
    "cost_gate"
   ]
  }
 },
 {
  "name": "cost_gate: open session rt 2.5 meets floor -> NET",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 2.5,
    "source": "measured",
    "session": "open"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "cost_gate: unmeasured symbol with rt > 0 -> NET",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "CL",
    "rt_pts": 0.02,
    "source": "guess"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "cost_gate: unmeasured symbol with rt 0 -> GROSS, blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "CL",
    "rt_pts": 0,
    "source": "none"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "GROSS",
   "blocked_by": [
    "cost_gate"
   ]
  }
 },
 {
  "name": "cost_gate: cost_model without symbol -> GROSS, blocked (missing field fails the rule)",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "GROSS",
   "blocked_by": [
    "cost_gate"
   ]
  }
 },
 {
  "name": "cost_gate: cost_model missing -> GROSS, blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": null,
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "GROSS",
   "blocked_by": [
    "cost_gate"
   ]
  }
 },
 {
  "name": "variant_counter: 25 variants, no p_value -> blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": null,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 25,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": [
    "variant_counter"
   ]
  }
 },
 {
  "name": "variant_counter: 25 variants, perm p -> blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "perm",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 25,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": [
    "variant_counter"
   ]
  }
 },
 {
  "name": "variant_counter: 25 variants, RC p above alpha -> blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.08,
   "p_kind": "RC",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 25,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": [
    "variant_counter"
   ]
  }
 },
 {
  "name": "variant_counter: 25 variants, RC p 0.03 -> PASS",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.03,
   "p_kind": "RC",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 25,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "variant_counter: 25 variants, SPA p exactly alpha -> PASS",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.05,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 25,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "variant_counter: exactly 20 variants, no p -> PASS (limit is >)",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": null,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 20,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "variant_counter: variants_tried unknown, SPA p 0.01 -> PASS (corrected p clears the rule without the count)",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": null,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "variant_counter: variants_tried unknown, perm p -> blocked (missing count fails the rule)",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "perm",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": null,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": [
    "variant_counter"
   ]
  }
 },
 {
  "name": "variant_counter: custom variant_limit 3 -> blocked at 4 with no p",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": null,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": false,
    "variant_counter": true,
    "null_first": false,
    "experiment_ledger": false
   },
   "variant_limit": 3,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 4,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": [
    "variant_counter"
   ]
  }
 },
 {
  "name": "null_first: no null ran -> blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": null,
   "null_pf": null,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": [
    "null_first"
   ]
  }
 },
 {
  "name": "null_first: flip null_pf above 1 -> blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 1.1,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": [
    "null_first"
   ]
  }
 },
 {
  "name": "null_first: flip null_pf beats real pf -> blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 0.85,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": [
    "null_first"
   ]
  }
 },
 {
  "name": "null_first: flip null_pf missing -> blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": null,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": [
    "null_first"
   ]
  }
 },
 {
  "name": "null_first: random_entry pct 96 -> PASS",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "random_entry",
   "null_pf": null,
   "null_pct": 96,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "null_first: random_entry pct 95 exactly -> PASS",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "random_entry",
   "null_pf": 1.4,
   "null_pct": 95,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "null_first: random_entry pct 80 but null_pf < pf -> blocked (pct present must be >= 95)",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "random_entry",
   "null_pf": 1.0,
   "null_pct": 80,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": [
    "null_first"
   ]
  }
 },
 {
  "name": "null_first: random_entry no pct, null_pf < pf -> PASS",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "random_entry",
   "null_pf": 1.1,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "PASS",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "null_first: random_entry no pct, null_pf >= pf -> blocked",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "random_entry",
   "null_pf": 1.6,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": [
    "null_first"
   ]
  }
 },
 {
  "name": "rules disabled: GROSS, 50 variants, no null -> PASS kept",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": null,
   "p_kind": "SPA",
   "costs_applied": false,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": null,
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": false,
    "variant_counter": false,
    "null_first": false,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 50,
  "expect": {
   "verdict": "PASS",
   "basis": "GROSS",
   "blocked_by": []
  }
 },
 {
  "name": "policy empty object (missing/broken file) -> all rules off",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": false,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": null,
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {},
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": null,
  "expect": {
   "verdict": "PASS",
   "basis": "GROSS",
   "blocked_by": []
  }
 },
 {
  "name": "only cost_gate on: blocks GROSS, ignores others",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": null,
   "p_kind": "SPA",
   "costs_applied": false,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": null,
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": false,
    "null_first": false,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 50,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "GROSS",
   "blocked_by": [
    "cost_gate"
   ]
  }
 },
 {
  "name": "downgrade-only: FAIL stays FAIL with every rule failing, nothing listed",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": null,
   "p_kind": "SPA",
   "costs_applied": false,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": null,
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": false,
   "verdict": "FAIL"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 50,
  "expect": {
   "verdict": "FAIL",
   "basis": "GROSS",
   "blocked_by": []
  }
 },
 {
  "name": "downgrade-only: INCONCLUSIVE never upgraded",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": 0.01,
   "p_kind": "SPA",
   "costs_applied": true,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": "flip",
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": false,
   "verdict": "INCONCLUSIVE"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 5,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "NET",
   "blocked_by": []
  }
 },
 {
  "name": "several rules at once, fixed order",
  "verdict_in": {
   "schema": "verdict/2",
   "test": "case",
   "idea": "demo",
   "variant": "abc123",
   "pf": 1.5,
   "t_stat": 2.5,
   "p_value": null,
   "p_kind": "SPA",
   "costs_applied": false,
   "cost_model": {
    "symbol": "NQ",
    "rt_pts": 1.0,
    "source": "measured"
   },
   "null_kind": null,
   "null_pf": 0.9,
   "null_pct": null,
   "gates_pass": true,
   "verdict": "PASS"
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": 30,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "GROSS",
   "blocked_by": [
    "cost_gate",
    "variant_counter",
    "null_first"
   ]
  }
 },
 {
  "name": "v1 input, all rules on -> cost_gate and null_first fail on missing fields; SPA p clears variant_counter",
  "verdict_in": {
   "schema": "verdict/1",
   "test": "old",
   "slug": null,
   "pf": 1.6,
   "t_stat": 3.0,
   "p_value": 0.01,
   "p_kind": "SPA",
   "n_trades": 300,
   "gates": [
    {
     "name": "pf",
     "metric": "pf",
     "op": ">=",
     "threshold": 1.3,
     "value": 1.6,
     "pass": true
    }
   ],
   "verdict": "PASS",
   "notes": ""
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": true,
    "variant_counter": true,
    "null_first": true,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": null,
  "expect": {
   "verdict": "INCONCLUSIVE",
   "basis": "GROSS",
   "blocked_by": [
    "cost_gate",
    "null_first"
   ]
  }
 },
 {
  "name": "v1 input, rules off -> PASS kept, GROSS",
  "verdict_in": {
   "schema": "verdict/1",
   "test": "old",
   "slug": null,
   "pf": 1.6,
   "t_stat": 3.0,
   "p_value": 0.01,
   "p_kind": "SPA",
   "n_trades": 300,
   "gates": [
    {
     "name": "pf",
     "metric": "pf",
     "op": ">=",
     "threshold": 1.3,
     "value": 1.6,
     "pass": true
    }
   ],
   "verdict": "PASS",
   "notes": ""
  },
  "policy": {
   "schema": "policy/1",
   "rules": {
    "cost_gate": false,
    "variant_counter": false,
    "null_first": false,
    "experiment_ledger": false
   },
   "variant_limit": 20,
   "rc_alpha": 0.05
  },
  "costs": {
   "NQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   },
   "MNQ": {
    "rt_pts": 0.9,
    "rt_pts_open": 2.5,
    "source": "project_entry_research_e1e2.md + project_costflip_2026_10_07.md"
   }
  },
  "variants_tried": null,
  "expect": {
   "verdict": "PASS",
   "basis": "GROSS",
   "blocked_by": []
  }
 }
]
