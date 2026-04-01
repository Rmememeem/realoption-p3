(function (global) {
  const DAY_NAMES = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
  const NEG_INF = -1e15;

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function round(value, digits) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function baseIndex(t, s) {
    return t * 2 + s;
  }

  function ext1Index(t, s, nStates) {
    return t * nStates + s;
  }

  function ext2Index(t, s, c, nCum) {
    return (t * 2 + s) * nCum + c;
  }

  function createRng(seed) {
    let state = (seed >>> 0) || 1;
    return function next() {
      state += 0x6d2b79f5;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function flattenScenario(scenario) {
    const margins = [];
    const demands = [];
    const startups = [];
    scenario.base.forEach((day) => {
      day.margins.forEach((value) => margins.push(Number(value)));
      day.demands.forEach((value) => demands.push(Number(value)));
      day.startups.forEach((value) => startups.push(Number(value)));
    });

    return {
      margins,
      demands,
      startups,
      stochasticSunday: scenario.stochasticSunday.map((row) => ({
        hour: Number(row.hour),
        d1: Number(row.d1),
        p1: Number(row.p1),
        d2: Number(row.d2),
        p2: Number(row.p2)
      })),
      parameters: {
        minRuntimeHours: Number(scenario.parameters.minRuntimeHours),
        productionCapMwh: Number(scenario.parameters.productionCapMwh),
        productionStepMwh: Number(scenario.parameters.productionStepMwh),
        mcIterations: Number(scenario.parameters.mcIterations),
        seed: Number(scenario.parameters.seed)
      }
    };
  }

  function validateScenario(flat) {
    const errors = [];
    const warnings = [];

    if (flat.margins.length !== 168 || flat.demands.length !== 168 || flat.startups.length !== 168) {
      errors.push("The weekly dataset must contain 168 hourly values for margins, demands, and startup costs.");
    }

    if (flat.stochasticSunday.length !== 24) {
      errors.push("The stochastic Sunday table must contain exactly 24 rows.");
    }

    if (!Number.isInteger(flat.parameters.minRuntimeHours) || flat.parameters.minRuntimeHours < 1) {
      errors.push("Minimum runtime must be a positive integer.");
    }

    if (!Number.isInteger(flat.parameters.productionStepMwh) || flat.parameters.productionStepMwh < 1) {
      errors.push("Production step must be a positive integer.");
    }

    if (flat.parameters.productionCapMwh < 0) {
      errors.push("Production cap must be non-negative.");
    }

    if (!Number.isInteger(flat.parameters.mcIterations) || flat.parameters.mcIterations < 100) {
      warnings.push("Monte Carlo iterations below 100 will produce noisy estimates.");
    }

    flat.stochasticSunday.forEach((row, index) => {
      const probabilitySum = row.p1 + row.p2;
      if (row.p1 < 0 || row.p1 > 1 || row.p2 < 0 || row.p2 > 1) {
        errors.push(`Probabilities on Sunday hour ${index + 1} must lie in [0, 1].`);
      }
      if (Math.abs(probabilitySum - 1) > 1e-9) {
        errors.push(`Probabilities on Sunday hour ${index + 1} must sum to 1.`);
      }
    });

    const step = flat.parameters.productionStepMwh;
    flat.demands.forEach((value, index) => {
      if (value % step !== 0) {
        errors.push(`Deterministic demand at t=${index + 1} must be divisible by the production step ${step}.`);
      }
    });

    flat.stochasticSunday.forEach((row, index) => {
      if (row.d1 % step !== 0 || row.d2 % step !== 0) {
        errors.push(`Stochastic Sunday demands at hour ${index + 1} must be divisible by the production step ${step}.`);
      }
    });

    return { errors, warnings };
  }

  function solveBase(margins, demands, startups) {
    const T = margins.length;
    const V = new Float64Array((T + 1) * 2);
    const X = new Int8Array(T * 2);

    V[baseIndex(T, 0)] = 0;
    V[baseIndex(T, 1)] = NEG_INF;

    for (let t = T - 1; t >= 0; t -= 1) {
      const m = margins[t];
      const d = demands[t];
      const f = startups[t];

      const stayOff = V[baseIndex(t + 1, 0)];
      const turnOn = m * d - f + V[baseIndex(t + 1, 1)];
      if (turnOn > stayOff) {
        V[baseIndex(t, 0)] = turnOn;
        X[baseIndex(t, 0)] = 1;
      } else {
        V[baseIndex(t, 0)] = stayOff;
        X[baseIndex(t, 0)] = 0;
      }

      const stayOn = m * d + V[baseIndex(t + 1, 1)];
      const turnOff = V[baseIndex(t + 1, 0)];
      if (stayOn >= turnOff) {
        V[baseIndex(t, 1)] = stayOn;
        X[baseIndex(t, 1)] = 0;
      } else {
        V[baseIndex(t, 1)] = turnOff;
        X[baseIndex(t, 1)] = -1;
      }
    }

    return { T, V, X };
  }

  function extractBaseSchedule(solution, initialState) {
    const { T, X } = solution;
    const states = new Int8Array(T + 1);
    const decisions = new Int8Array(T);
    states[0] = initialState || 0;

    for (let t = 0; t < T; t += 1) {
      const state = states[t];
      const decision = X[baseIndex(t, state)];
      decisions[t] = decision;
      if (state === 0 && decision === 1) {
        states[t + 1] = 1;
      } else if (state === 1 && decision === -1) {
        states[t + 1] = 0;
      } else {
        states[t + 1] = state;
      }
    }

    return { states, decisions };
  }

  function solveExt1(margins, demands, startups, minHours) {
    const T = margins.length;
    const nStates = minHours + 1;
    const V = new Float64Array((T + 1) * nStates);
    const X = new Int8Array(T * nStates);
    V.fill(NEG_INF);
    V[ext1Index(T, 0, nStates)] = 0;

    for (let t = T - 1; t >= 0; t -= 1) {
      const m = margins[t];
      const d = demands[t];
      const f = startups[t];

      const stayOff = V[ext1Index(t + 1, 0, nStates)];
      const turnOn = m * d - f + V[ext1Index(t + 1, 1, nStates)];
      if (turnOn > stayOff) {
        V[ext1Index(t, 0, nStates)] = turnOn;
        X[ext1Index(t, 0, nStates)] = 1;
      } else {
        V[ext1Index(t, 0, nStates)] = stayOff;
        X[ext1Index(t, 0, nStates)] = 0;
      }

      for (let k = 1; k < minHours; k += 1) {
        V[ext1Index(t, k, nStates)] = m * d + V[ext1Index(t + 1, k + 1, nStates)];
        X[ext1Index(t, k, nStates)] = 0;
      }

      const stayOn = m * d + V[ext1Index(t + 1, minHours, nStates)];
      const turnOff = V[ext1Index(t + 1, 0, nStates)];
      if (stayOn >= turnOff) {
        V[ext1Index(t, minHours, nStates)] = stayOn;
        X[ext1Index(t, minHours, nStates)] = 0;
      } else {
        V[ext1Index(t, minHours, nStates)] = turnOff;
        X[ext1Index(t, minHours, nStates)] = -1;
      }
    }

    return { T, V, X, minHours, nStates };
  }

  function extractExt1Schedule(solution) {
    const { T, X, minHours, nStates } = solution;
    const statesDetail = new Int16Array(T + 1);
    const statesBinary = new Int8Array(T + 1);
    const decisions = new Int8Array(T);

    for (let t = 0; t < T; t += 1) {
      const state = statesDetail[t];
      const decision = X[ext1Index(t, state, nStates)];
      decisions[t] = decision;

      if (state === 0 && decision === 1) {
        statesDetail[t + 1] = 1;
      } else if (state === 0 && decision === 0) {
        statesDetail[t + 1] = 0;
      } else if (state > 0 && state < minHours) {
        statesDetail[t + 1] = state + 1;
      } else if (state === minHours && decision === -1) {
        statesDetail[t + 1] = 0;
      } else {
        statesDetail[t + 1] = minHours;
      }

      statesBinary[t + 1] = statesDetail[t + 1] > 0 ? 1 : 0;
    }

    return { statesDetail, statesBinary, decisions };
  }

  function solveExt2(margins, demands, startups, maxMwh, stepMwh) {
    const T = margins.length;
    const nCum = Math.floor(maxMwh / stepMwh) + 1;
    const V = new Float64Array((T + 1) * 2 * nCum);
    const X = new Int8Array(T * 2 * nCum);
    V.fill(NEG_INF);

    for (let c = 0; c < nCum; c += 1) {
      V[ext2Index(T, 0, c, nCum)] = 0;
      V[ext2Index(T, 1, c, nCum)] = NEG_INF;
    }

    for (let t = T - 1; t >= 0; t -= 1) {
      const m = margins[t];
      const d = demands[t];
      const f = startups[t];
      const dStep = Math.round(d / stepMwh);

      for (let c = 0; c < nCum; c += 1) {
        const stayOff = V[ext2Index(t + 1, 0, c, nCum)];
        const newC = c + dStep;
        const turnOn = newC < nCum ? m * d - f + V[ext2Index(t + 1, 1, newC, nCum)] : NEG_INF;
        if (turnOn > stayOff) {
          V[ext2Index(t, 0, c, nCum)] = turnOn;
          X[ext2Index(t, 0, c, nCum)] = 1;
        } else {
          V[ext2Index(t, 0, c, nCum)] = stayOff;
          X[ext2Index(t, 0, c, nCum)] = 0;
        }

        const stayOn = newC < nCum ? m * d + V[ext2Index(t + 1, 1, newC, nCum)] : NEG_INF;
        const turnOff = V[ext2Index(t + 1, 0, c, nCum)];
        if (stayOn >= turnOff) {
          V[ext2Index(t, 1, c, nCum)] = stayOn;
          X[ext2Index(t, 1, c, nCum)] = 0;
        } else {
          V[ext2Index(t, 1, c, nCum)] = turnOff;
          X[ext2Index(t, 1, c, nCum)] = -1;
        }
      }
    }

    return { T, V, X, nCum, maxMwh, stepMwh };
  }

  function extractExt2Schedule(solution, demands) {
    const { T, X, nCum, stepMwh } = solution;
    const states = new Int8Array(T + 1);
    const cumSteps = new Int16Array(T + 1);
    const decisions = new Int8Array(T);

    for (let t = 0; t < T; t += 1) {
      const state = states[t];
      const cum = cumSteps[t];
      const decision = X[ext2Index(t, state, cum, nCum)];
      const dStep = Math.round(demands[t] / stepMwh);
      decisions[t] = decision;

      if (state === 0 && decision === 1) {
        states[t + 1] = 1;
        cumSteps[t + 1] = cum + dStep;
      } else if (state === 1 && decision === 0) {
        states[t + 1] = 1;
        cumSteps[t + 1] = cum + dStep;
      } else if (state === 1 && decision === -1) {
        states[t + 1] = 0;
        cumSteps[t + 1] = cum;
      } else {
        states[t + 1] = 0;
        cumSteps[t + 1] = cum;
      }
    }

    return { states, cumSteps, decisions, cumMwh: Array.from(cumSteps, (value) => value * stepMwh) };
  }

  function solveExt3(margins, demands, startups, stochasticSunday, maxMwh, stepMwh) {
    const T = margins.length;
    const nCum = Math.floor(maxMwh / stepMwh) + 1;
    const V = new Float64Array((T + 1) * 2 * nCum);
    const X = new Int8Array(T * 2 * nCum);
    V.fill(NEG_INF);

    for (let c = 0; c < nCum; c += 1) {
      V[ext2Index(T, 0, c, nCum)] = 0;
      V[ext2Index(T, 1, c, nCum)] = NEG_INF;
    }

    for (let t = T - 1; t >= 0; t -= 1) {
      const m = margins[t];
      const f = startups[t];
      const dayIndex = Math.floor(t / 24);
      const hourIndex = t % 24;
      const scenarios = dayIndex === 6
        ? [
            { demand: stochasticSunday[hourIndex].d1, probability: stochasticSunday[hourIndex].p1 },
            { demand: stochasticSunday[hourIndex].d2, probability: stochasticSunday[hourIndex].p2 }
          ]
        : [{ demand: demands[t], probability: 1 }];

      for (let c = 0; c < nCum; c += 1) {
        const stayOff = V[ext2Index(t + 1, 0, c, nCum)];
        let turnOn = 0;
        let feasibleOn = true;
        for (let i = 0; i < scenarios.length; i += 1) {
          const d = scenarios[i].demand;
          const probability = scenarios[i].probability;
          const newC = c + Math.round(d / stepMwh);
          if (newC >= nCum) {
            feasibleOn = false;
            break;
          }
          turnOn += probability * (m * d - f + V[ext2Index(t + 1, 1, newC, nCum)]);
        }
        if (!feasibleOn) {
          turnOn = NEG_INF;
        }
        if (turnOn > stayOff) {
          V[ext2Index(t, 0, c, nCum)] = turnOn;
          X[ext2Index(t, 0, c, nCum)] = 1;
        } else {
          V[ext2Index(t, 0, c, nCum)] = stayOff;
          X[ext2Index(t, 0, c, nCum)] = 0;
        }

        let stayOn = 0;
        let feasibleStay = true;
        for (let i = 0; i < scenarios.length; i += 1) {
          const d = scenarios[i].demand;
          const probability = scenarios[i].probability;
          const newC = c + Math.round(d / stepMwh);
          if (newC >= nCum) {
            feasibleStay = false;
            break;
          }
          stayOn += probability * (m * d + V[ext2Index(t + 1, 1, newC, nCum)]);
        }
        if (!feasibleStay) {
          stayOn = NEG_INF;
        }
        const turnOff = V[ext2Index(t + 1, 0, c, nCum)];
        if (stayOn >= turnOff) {
          V[ext2Index(t, 1, c, nCum)] = stayOn;
          X[ext2Index(t, 1, c, nCum)] = 0;
        } else {
          V[ext2Index(t, 1, c, nCum)] = turnOff;
          X[ext2Index(t, 1, c, nCum)] = -1;
        }
      }
    }

    return { T, V, X, nCum, maxMwh, stepMwh };
  }

  function deriveExpectedSundayDemands(demands, stochasticSunday) {
    const values = demands.slice();
    for (let hour = 0; hour < 24; hour += 1) {
      values[144 + hour] = stochasticSunday[hour].d1 * stochasticSunday[hour].p1 + stochasticSunday[hour].d2 * stochasticSunday[hour].p2;
    }
    return values;
  }

  function deriveStatuses(states) {
    const statuses = [];
    for (let t = 0; t < states.length - 1; t += 1) {
      if (states[t] === 0 && states[t + 1] === 1) {
        statuses.push("ON*");
      } else if (states[t + 1] === 1) {
        statuses.push("ON");
      } else {
        statuses.push(".");
      }
    }
    return statuses;
  }

  function summarizeDeterministicCase(label, states, margins, demands, startups) {
    let profit = 0;
    let production = 0;
    let startupsCount = 0;

    for (let t = 0; t < states.length - 1; t += 1) {
      if (states[t] === 0 && states[t + 1] === 1) {
        profit += margins[t] * demands[t] - startups[t];
        production += demands[t];
        startupsCount += 1;
      } else if (states[t + 1] === 1) {
        profit += margins[t] * demands[t];
        production += demands[t];
      }
    }

    return {
      label,
      profit,
      production,
      startups: startupsCount,
      statuses: deriveStatuses(states)
    };
  }

  function percentile(values, p) {
    if (!values.length) {
      return 0;
    }
    const sorted = values.slice().sort((a, b) => a - b);
    const position = (sorted.length - 1) * p;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) {
      return sorted[lower];
    }
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function buildHistogram(values, bins) {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, 1);
    const width = span / bins;
    const counts = new Array(bins).fill(0);
    values.forEach((value) => {
      const rawIndex = Math.floor((value - min) / width);
      const index = Math.min(bins - 1, Math.max(0, rawIndex));
      counts[index] += 1;
    });
    return counts.map((count, index) => ({
      x0: min + index * width,
      x1: min + (index + 1) * width,
      count
    }));
  }

  function simulateMonteCarlo(policySolution, flat, iterations, seed) {
    const rng = createRng(seed);
    const profits = [];
    const finalProduction = [];
    const { X, nCum, stepMwh, T } = policySolution;
    const { margins, demands, startups, stochasticSunday } = flat;

    for (let path = 0; path < iterations; path += 1) {
      let state = 0;
      let cum = 0;
      let profit = 0;

      for (let t = 0; t < T; t += 1) {
        const dayIndex = Math.floor(t / 24);
        const hourIndex = t % 24;
        let realizedDemand = demands[t];

        if (dayIndex === 6) {
          const row = stochasticSunday[hourIndex];
          realizedDemand = rng() < row.p1 ? row.d1 : row.d2;
        }

        const decision = X[ext2Index(t, state, cum, nCum)];
        const dStep = Math.round(realizedDemand / stepMwh);

        if (state === 0 && decision === 1) {
          profit += margins[t] * realizedDemand - startups[t];
          state = 1;
          cum += dStep;
        } else if (state === 1 && decision === 0) {
          profit += margins[t] * realizedDemand;
          state = 1;
          cum += dStep;
        } else if (state === 1 && decision === -1) {
          state = 0;
        }
      }

      profits.push(profit);
      finalProduction.push(cum * stepMwh);
    }

    const mean = profits.reduce((sum, value) => sum + value, 0) / profits.length;
    const variance = profits.reduce((sum, value) => sum + (value - mean) ** 2, 0) / profits.length;

    return {
      iterations,
      mean,
      stdDev: Math.sqrt(variance),
      p05: percentile(profits, 0.05),
      p50: percentile(profits, 0.5),
      p95: percentile(profits, 0.95),
      min: Math.min(...profits),
      max: Math.max(...profits),
      avgProduction: finalProduction.reduce((sum, value) => sum + value, 0) / finalProduction.length,
      histogram: buildHistogram(profits, 24)
    };
  }

  function computeValidation(validationData) {
    const solution = solveBase(validationData.margins, validationData.demands, validationData.startups);
    const value = solution.V[baseIndex(0, 0)];
    const decisions = Array.from(solution.X).filter((_, index) => index % 2 === 0);
    const matches = decisions.every((valueAtHour, index) => valueAtHour === validationData.reference.xS0[index]);

    return {
      calculatedV1s0: value,
      referenceV1s0: validationData.reference.V1s0,
      absoluteGap: Math.abs(value - validationData.reference.V1s0),
      s0DecisionMatch: matches,
      xS0: decisions
    };
  }

  function computeScenario(rawScenario, validationData) {
    const scenario = deepClone(rawScenario);
    const flat = flattenScenario(scenario);
    const diagnostics = validateScenario(flat);
    if (diagnostics.errors.length) {
      return { diagnostics, scenario };
    }

    const baseSolution = solveBase(flat.margins, flat.demands, flat.startups);
    const baseSchedule = extractBaseSchedule(baseSolution, 0);
    const baseSummary = summarizeDeterministicCase("Base", baseSchedule.states, flat.margins, flat.demands, flat.startups);

    const ext1Solution = solveExt1(flat.margins, flat.demands, flat.startups, flat.parameters.minRuntimeHours);
    const ext1Schedule = extractExt1Schedule(ext1Solution);
    const ext1Summary = summarizeDeterministicCase("Ext 1", ext1Schedule.statesBinary, flat.margins, flat.demands, flat.startups);

    const ext2Solution = solveExt2(flat.margins, flat.demands, flat.startups, flat.parameters.productionCapMwh, flat.parameters.productionStepMwh);
    const ext2Schedule = extractExt2Schedule(ext2Solution, flat.demands);
    const ext2Summary = summarizeDeterministicCase("Ext 2", ext2Schedule.states, flat.margins, flat.demands, flat.startups);

    const ext3Solution = solveExt3(flat.margins, flat.demands, flat.startups, flat.stochasticSunday, flat.parameters.productionCapMwh, flat.parameters.productionStepMwh);
    const expectedDemands = deriveExpectedSundayDemands(flat.demands, flat.stochasticSunday);
    const ext3Deterministic = solveExt2(flat.margins, expectedDemands, flat.startups, flat.parameters.productionCapMwh, flat.parameters.productionStepMwh);
    const monteCarlo = simulateMonteCarlo(ext3Solution, flat, flat.parameters.mcIterations, flat.parameters.seed);
    const validation = validationData ? computeValidation(validationData) : null;

    const caseCards = [
      { label: "Base", profit: baseSummary.profit, production: baseSummary.production, startups: baseSummary.startups, deltaVsBase: 0 },
      { label: "Ext 1", profit: ext1Summary.profit, production: ext1Summary.production, startups: ext1Summary.startups, deltaVsBase: ext1Summary.profit - baseSummary.profit },
      { label: "Ext 2", profit: ext2Summary.profit, production: ext2Summary.production, startups: ext2Summary.startups, deltaVsBase: ext2Summary.profit - baseSummary.profit },
      { label: "Ext 3", profit: ext3Solution.V[ext2Index(0, 0, 0, ext3Solution.nCum)], production: null, startups: null, deltaVsBase: ext3Solution.V[ext2Index(0, 0, 0, ext3Solution.nCum)] - baseSummary.profit },
      { label: "Ext 3 with E[D]", profit: ext3Deterministic.V[ext2Index(0, 0, 0, ext3Deterministic.nCum)], production: null, startups: null, deltaVsBase: ext3Deterministic.V[ext2Index(0, 0, 0, ext3Deterministic.nCum)] - baseSummary.profit }
    ];

    return {
      diagnostics,
      scenario,
      validation,
      flat,
      cases: {
        base: {
          summary: baseSummary,
          statuses: baseSummary.statuses,
          states: Array.from(baseSchedule.states),
          decisionsS0: Array.from({ length: flat.margins.length }, (_, t) => baseSolution.X[baseIndex(t, 0)]),
          decisionsS1: Array.from({ length: flat.margins.length }, (_, t) => baseSolution.X[baseIndex(t, 1)]),
          valuesS0: Array.from({ length: flat.margins.length }, (_, t) => baseSolution.V[baseIndex(t, 0)]),
          valuesS1: Array.from({ length: flat.margins.length }, (_, t) => baseSolution.V[baseIndex(t, 1)])
        },
        ext1: {
          summary: ext1Summary,
          statuses: ext1Summary.statuses,
          statesBinary: Array.from(ext1Schedule.statesBinary)
        },
        ext2: {
          summary: ext2Summary,
          statuses: ext2Summary.statuses,
          states: Array.from(ext2Schedule.states),
          cumMwh: ext2Schedule.cumMwh
        },
        ext3: {
          expectedProfit: ext3Solution.V[ext2Index(0, 0, 0, ext3Solution.nCum)],
          expectedDemandProxyProfit: ext3Deterministic.V[ext2Index(0, 0, 0, ext3Deterministic.nCum)],
          monteCarlo
        }
      },
      caseCards,
      meta: {
        baseProfit: baseSummary.profit,
        ext3MinusProxy: ext3Solution.V[ext2Index(0, 0, 0, ext3Solution.nCum)] - ext3Deterministic.V[ext2Index(0, 0, 0, ext3Deterministic.nCum)]
      }
    };
  }

  const api = {
    DAY_NAMES,
    NEG_INF,
    deepClone,
    round,
    flattenScenario,
    validateScenario,
    solveBase,
    solveExt1,
    solveExt2,
    solveExt3,
    computeValidation,
    computeScenario
  };

  global.DispatchModel = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
