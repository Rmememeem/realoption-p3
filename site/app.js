(function () {
  const model = window.DispatchModel;
  const defaultScenario = model.deepClone(window.DEFAULT_SCENARIO);
  const validationData = model.deepClone(window.VALIDATION_24H);

  const state = {
    currentMatrixView: "values-s0",
    result: null
  };

  const currencyFormatter = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2
  });

  const numberFormatter = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2
  });

  const refs = {
    parameterGrid: document.getElementById("parameter-grid"),
    diagnostics: document.getElementById("diagnostics"),
    validationCard: document.getElementById("validation-card"),
    caseCards: document.getElementById("case-cards"),
    comparisonTable: document.getElementById("comparison-table"),
    scheduleWrap: document.getElementById("schedule-wrap"),
    mcSummary: document.getElementById("mc-summary"),
    mcChart: document.getElementById("mc-chart"),
    profitChart: document.getElementById("profit-chart"),
    marginsChart: document.getElementById("margins-chart"),
    valuesChart: document.getElementById("values-chart"),
    cumChart: document.getElementById("cum-chart"),
    marginsEditor: document.getElementById("margins-editor"),
    demandsEditor: document.getElementById("demands-editor"),
    startupsEditor: document.getElementById("startups-editor"),
    stochasticEditor: document.getElementById("stochastic-editor"),
    matrixView: document.getElementById("matrix-view"),
    runModel: document.getElementById("run-model"),
    resetDefaults: document.getElementById("reset-defaults"),
    exportJson: document.getElementById("export-json")
  };

  const parameterFields = [
    { key: "minRuntimeHours", label: "Min runtime (hours)", step: "1" },
    { key: "productionCapMwh", label: "Production cap (MWh)", step: "50" },
    { key: "productionStepMwh", label: "Production step (MWh)", step: "50" },
    { key: "mcIterations", label: "Monte Carlo iterations", step: "100" },
    { key: "seed", label: "Random seed", step: "1" }
  ];

  function formatMoney(value) {
    return value == null || Number.isNaN(value) ? "n/a" : currencyFormatter.format(value);
  }

  function formatNumber(value, digits) {
    if (value == null || Number.isNaN(value)) {
      return "n/a";
    }
    return digits == null ? numberFormatter.format(value) : model.round(value, digits).toLocaleString("fr-FR");
  }

  function weekMatrix(values) {
    const rows = [];
    for (let hour = 0; hour < 24; hour += 1) {
      const row = [];
      for (let day = 0; day < 7; day += 1) {
        row.push(values[day * 24 + hour]);
      }
      rows.push(row);
    }
    return rows;
  }

  function renderParameterGrid(scenario) {
    refs.parameterGrid.innerHTML = parameterFields
      .map((field) => {
        const value = scenario.parameters[field.key];
        return `
          <div class="parameter-field">
            <label for="param-${field.key}">${field.label}</label>
            <input id="param-${field.key}" type="number" step="${field.step}" value="${value}" />
          </div>
        `;
      })
      .join("");
  }

  function weeklyTableMarkup(metricKey, label, scenario, step) {
    const header = model.DAY_NAMES.map((day) => `<th>${day}</th>`).join("");
    const body = Array.from({ length: 24 }, (_, hourIndex) => {
      const cells = scenario.base
        .map((dayData, dayIndex) => {
          const value = dayData[metricKey][hourIndex];
          return `
            <td>
              <input
                type="number"
                step="${step}"
                data-metric="${metricKey}"
                data-day="${dayIndex}"
                data-hour="${hourIndex}"
                value="${value}"
              />
            </td>
          `;
        })
        .join("");
      return `<tr><td>H${hourIndex + 1}</td>${cells}</tr>`;
    }).join("");

    return `
      <div class="table-wrap">
        <table aria-label="${label}">
          <thead>
            <tr>
              <th>Hour</th>
              ${header}
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
  }

  function renderEditors(scenario) {
    refs.marginsEditor.innerHTML = weeklyTableMarkup("margins", "Margins", scenario, "0.01");
    refs.demandsEditor.innerHTML = weeklyTableMarkup("demands", "Demands", scenario, "50");
    refs.startupsEditor.innerHTML = weeklyTableMarkup("startups", "Startup costs", scenario, "100");

    const stochasticRows = scenario.stochasticSunday
      .map((row, index) => {
        return `
          <tr>
            <td>H${index + 1}</td>
            <td><input type="number" step="50" data-stoch="d1" data-hour="${index}" value="${row.d1}" /></td>
            <td><input type="number" step="0.05" data-stoch="p1" data-hour="${index}" value="${row.p1}" /></td>
            <td><input type="number" step="50" data-stoch="d2" data-hour="${index}" value="${row.d2}" /></td>
            <td><input type="number" step="0.05" data-stoch="p2" data-hour="${index}" value="${row.p2}" /></td>
          </tr>
        `;
      })
      .join("");

    refs.stochasticEditor.innerHTML = `
      <div class="table-wrap">
        <table aria-label="Stochastic Sunday">
          <thead>
            <tr>
              <th>Hour</th>
              <th>D1</th>
              <th>P1</th>
              <th>D2</th>
              <th>P2</th>
            </tr>
          </thead>
          <tbody>${stochasticRows}</tbody>
        </table>
      </div>
    `;
  }

  function readScenarioFromDom() {
    const scenario = model.deepClone(defaultScenario);

    parameterFields.forEach((field) => {
      const input = document.getElementById(`param-${field.key}`);
      scenario.parameters[field.key] = Number(input.value);
    });

    document.querySelectorAll("[data-metric]").forEach((input) => {
      const metric = input.dataset.metric;
      const day = Number(input.dataset.day);
      const hour = Number(input.dataset.hour);
      scenario.base[day][metric][hour] = Number(input.value);
    });

    document.querySelectorAll("[data-stoch]").forEach((input) => {
      const metric = input.dataset.stoch;
      const hour = Number(input.dataset.hour);
      scenario.stochasticSunday[hour][metric] = Number(input.value);
    });

    return scenario;
  }

  function populateScenarioIntoDom(scenario) {
    renderParameterGrid(scenario);
    renderEditors(scenario);
  }

  function renderDiagnostics(result) {
    const blocks = [];

    if (result.diagnostics.errors.length === 0) {
      blocks.push(`<div class="status-ok">No blocking input errors detected.</div>`);
    } else {
      result.diagnostics.errors.forEach((message) => {
        blocks.push(`<div class="status-error">${message}</div>`);
      });
    }

    result.diagnostics.warnings.forEach((message) => {
      blocks.push(`<div class="status-warning">${message}</div>`);
    });

    refs.diagnostics.innerHTML = blocks.join("");
  }

  function renderValidationCard(validation) {
    if (!validation) {
      refs.validationCard.innerHTML = `<div class="status-warning">Validation data unavailable.</div>`;
      return;
    }

    refs.validationCard.innerHTML = `
      <div class="validation-grid">
        <div class="validation-row"><span>Calculated V1(s=0)</span><strong>${formatMoney(validation.calculatedV1s0)}</strong></div>
        <div class="validation-row"><span>Reference V1(s=0)</span><strong>${formatMoney(validation.referenceV1s0)}</strong></div>
        <div class="validation-row"><span>Absolute gap</span><strong>${formatNumber(validation.absoluteGap, 6)}</strong></div>
        <div class="validation-row"><span>x_t(s=0) match</span><strong>${validation.s0DecisionMatch ? "Yes" : "No"}</strong></div>
      </div>
    `;
  }

  function renderCaseCards(caseCards) {
    refs.caseCards.innerHTML = caseCards
      .map((card) => {
        return `
          <article class="case-card">
            <h3>${card.label}</h3>
            <span class="case-profit">${formatMoney(card.profit)}</span>
            <div class="metric-list">
              <div class="metric-line"><span>Production</span><strong>${card.production == null ? "n/a" : `${formatNumber(card.production, 0)} MWh`}</strong></div>
              <div class="metric-line"><span>Startups</span><strong>${card.startups == null ? "n/a" : card.startups}</strong></div>
              <div class="metric-line"><span>Delta vs base</span><strong>${formatMoney(card.deltaVsBase)}</strong></div>
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderComparisonTable(caseCards) {
    const rows = caseCards
      .map((card) => {
        return `
          <tr>
            <td>${card.label}</td>
            <td>${formatMoney(card.profit)}</td>
            <td>${card.production == null ? "n/a" : formatNumber(card.production, 0)}</td>
            <td>${card.startups == null ? "n/a" : card.startups}</td>
            <td>${formatMoney(card.deltaVsBase)}</td>
          </tr>
        `;
      })
      .join("");

    refs.comparisonTable.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Case</th>
              <th>Profit</th>
              <th>MWh</th>
              <th>Startups</th>
              <th>Delta vs base</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function scheduleCard(title, subtitle, statuses) {
    const matrix = weekMatrix(statuses);
    const header = model.DAY_NAMES.map((day) => `<div class="head">${day}</div>`).join("");
    const body = matrix
      .map((row, hourIndex) => {
        const cells = row
          .map((value) => {
            const className = value === "ON*" ? "cell-start" : value === "ON" ? "cell-on" : "cell-off";
            return `<div class="cell ${className}">${value}</div>`;
          })
          .join("");
        return `<div class="head cell-hour">H${hourIndex + 1}</div>${cells}`;
      })
      .join("");

    return `
      <article class="schedule-card">
        <div class="schedule-title">
          <h3>${title}</h3>
          <span class="schedule-subtitle">${subtitle}</span>
        </div>
        <div class="schedule-grid">
          <div class="head">Hour</div>
          ${header}
          ${body}
        </div>
      </article>
    `;
  }

  function renderSchedules(result) {
    const cards = [
      scheduleCard("Base schedule", `Profit ${formatMoney(result.cases.base.summary.profit)}`, result.cases.base.statuses),
      scheduleCard("Ext 1 schedule", `Min runtime ${result.scenario.parameters.minRuntimeHours}h`, result.cases.ext1.statuses),
      scheduleCard("Ext 2 schedule", `Cap ${formatNumber(result.scenario.parameters.productionCapMwh, 0)} MWh`, result.cases.ext2.statuses),
      `
        <article class="schedule-card">
          <div class="schedule-title">
            <h3>Ext 3 interpretation</h3>
            <span class="schedule-subtitle">Policy instead of a single fixed Sunday path</span>
          </div>
          <p class="hero-text">
            The stochastic extension keeps one optimal policy that reacts to the realized Sunday demand through the cumulative production state.
            The exact Bellman expectation is ${formatMoney(result.cases.ext3.expectedProfit)}, while the deterministic proxy with E[D] gives ${formatMoney(result.cases.ext3.expectedDemandProxyProfit)}.
          </p>
        </article>
      `
    ];

    refs.scheduleWrap.innerHTML = cards.join("");
  }

  function drawHistogram(histogram, exactExpected) {
    const canvas = refs.mcChart;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const left = 60;
    const right = width - 24;
    const top = 24;
    const bottom = height - 44;
    const plotWidth = right - left;
    const plotHeight = bottom - top;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#07111a";
    ctx.fillRect(0, 0, width, height);

    const maxCount = Math.max(...histogram.map((bin) => bin.count), 1);
    const minX = histogram[0].x0;
    const maxX = histogram[histogram.length - 1].x1;

    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    histogram.forEach((bin, index) => {
      const x0 = left + (index / histogram.length) * plotWidth + 2;
      const barWidth = plotWidth / histogram.length - 4;
      const barHeight = (bin.count / maxCount) * plotHeight;
      const y = bottom - barHeight;

      const gradient = ctx.createLinearGradient(0, y, 0, bottom);
      gradient.addColorStop(0, "#d79a4a");
      gradient.addColorStop(1, "#83c5be");
      ctx.fillStyle = gradient;
      ctx.fillRect(x0, y, barWidth, barHeight);
    });

    const exactX = left + ((exactExpected - minX) / Math.max(maxX - minX, 1)) * plotWidth;
    ctx.strokeStyle = "#f3ebd8";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(exactX, top);
    ctx.lineTo(exactX, bottom);
    ctx.stroke();

    ctx.fillStyle = "#95a7b8";
    ctx.font = '12px "Trebuchet MS"';
    ctx.fillText(formatMoney(minX), left, height - 18);
    ctx.fillText(formatMoney(maxX), right - 90, height - 18);
    ctx.fillText("MC profit distribution", left, 16);
    ctx.fillText("Exact Bellman EV", Math.min(width - 120, exactX + 8), 18);
  }

  function renderMonteCarlo(ext3) {
    const mc = ext3.monteCarlo;
    refs.mcSummary.innerHTML = `
      <div class="mc-pill"><span>Exact EV</span><strong>${formatMoney(ext3.expectedProfit)}</strong></div>
      <div class="mc-pill"><span>MC mean</span><strong>${formatMoney(mc.mean)}</strong></div>
      <div class="mc-pill"><span>Std dev</span><strong>${formatMoney(mc.stdDev)}</strong></div>
      <div class="mc-pill"><span>P05</span><strong>${formatMoney(mc.p05)}</strong></div>
      <div class="mc-pill"><span>Median</span><strong>${formatMoney(mc.p50)}</strong></div>
      <div class="mc-pill"><span>P95</span><strong>${formatMoney(mc.p95)}</strong></div>
    `;

    drawHistogram(mc.histogram, ext3.expectedProfit);
  }

  function setupCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#07111a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    return {
      ctx,
      width: canvas.width,
      height: canvas.height,
      left: 56,
      right: canvas.width - 22,
      top: 24,
      bottom: canvas.height - 36
    };
  }

  function drawAxes(plot, yLabels) {
    const { ctx, left, right, top, bottom } = plot;
    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    ctx.font = '12px "Trebuchet MS"';
    ctx.fillStyle = "#95a7b8";
    if (yLabels) {
      yLabels.forEach((label) => {
        ctx.fillText(label.text, 10, label.y + 4);
        ctx.strokeStyle = "rgba(255,255,255,0.06)";
        ctx.beginPath();
        ctx.moveTo(left, label.y);
        ctx.lineTo(right, label.y);
        ctx.stroke();
      });
    }
  }

  function drawDaySeparators(plot, pointsCount) {
    const { ctx, left, right, top, bottom } = plot;
    const plotWidth = right - left;
    for (let day = 1; day < 7; day += 1) {
      const x = left + (day * 24 / Math.max(pointsCount - 1, 1)) * plotWidth;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.fillStyle = "#95a7b8";
      ctx.fillText(model.DAY_NAMES[day], x + 4, top + 12);
    }
  }

  function drawLineSeries(plot, values, color, minValue, maxValue, width) {
    const { ctx, left, right, top, bottom } = plot;
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    const range = Math.max(maxValue - minValue, 1e-9);
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 2;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = left + (index / Math.max(values.length - 1, 1)) * plotWidth;
      const y = bottom - ((value - minValue) / range) * plotHeight;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }

  function drawProfitChart(caseCards) {
    const plot = setupCanvas(refs.profitChart);
    const { ctx, left, right, top, bottom } = plot;
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    const values = caseCards.map((card) => card.profit);
    const maxValue = Math.max(...values) * 1.05;
    const minValue = Math.min(...values) * 0.95;
    const range = Math.max(maxValue - minValue, 1);
    const barWidth = plotWidth / values.length * 0.58;

    drawAxes(plot, [
      { text: formatMoney(minValue), y: bottom },
      { text: formatMoney((minValue + maxValue) / 2), y: top + plotHeight / 2 },
      { text: formatMoney(maxValue), y: top }
    ]);

    values.forEach((value, index) => {
      const x = left + (index + 0.5) * (plotWidth / values.length) - barWidth / 2;
      const y = bottom - ((value - minValue) / range) * plotHeight;
      const gradient = ctx.createLinearGradient(0, y, 0, bottom);
      gradient.addColorStop(0, index === 0 ? "#83c5be" : "#d79a4a");
      gradient.addColorStop(1, "#28455e");
      ctx.fillStyle = gradient;
      ctx.fillRect(x, y, barWidth, bottom - y);
      ctx.fillStyle = "#f3ebd8";
      ctx.font = '12px "Trebuchet MS"';
      ctx.fillText(caseCards[index].label, x, bottom + 18);
    });
  }

  function drawMarginsChart(margins, statuses) {
    const plot = setupCanvas(refs.marginsChart);
    const { ctx, left, right, top, bottom } = plot;
    const plotWidth = right - left;
    const minValue = Math.min(...margins);
    const maxValue = Math.max(...margins);
    const zeroY = bottom - ((0 - minValue) / Math.max(maxValue - minValue, 1e-9)) * (bottom - top);

    drawAxes(plot, [
      { text: formatNumber(minValue, 2), y: bottom },
      { text: "0", y: zeroY },
      { text: formatNumber(maxValue, 2), y: top }
    ]);

    statuses.forEach((status, index) => {
      if (status === ".") return;
      const x0 = left + (index / margins.length) * plotWidth;
      const x1 = left + ((index + 1) / margins.length) * plotWidth;
      ctx.fillStyle = status === "ON*" ? "rgba(215,154,74,0.18)" : "rgba(131,197,190,0.12)";
      ctx.fillRect(x0, top, Math.max(1, x1 - x0), bottom - top);
    });

    drawDaySeparators(plot, margins.length);

    ctx.strokeStyle = "rgba(255,255,255,0.14)";
    ctx.beginPath();
    ctx.moveTo(left, zeroY);
    ctx.lineTo(right, zeroY);
    ctx.stroke();

    drawLineSeries(plot, margins, "#f2d5a4", minValue, maxValue, 2.2);
  }

  function drawValuesChart(valuesS0, valuesS1) {
    const plot = setupCanvas(refs.valuesChart);
    const combined = valuesS0.concat(valuesS1);
    const minValue = Math.min(...combined);
    const maxValue = Math.max(...combined);
    drawAxes(plot, [
      { text: formatMoney(minValue), y: plot.bottom },
      { text: formatMoney((minValue + maxValue) / 2), y: plot.top + (plot.bottom - plot.top) / 2 },
      { text: formatMoney(maxValue), y: plot.top }
    ]);
    drawDaySeparators(plot, valuesS0.length);
    drawLineSeries(plot, valuesS0, "#83c5be", minValue, maxValue, 2.4);
    drawLineSeries(plot, valuesS1, "#d79a4a", minValue, maxValue, 2.1);

    const { ctx } = plot;
    ctx.fillStyle = "#83c5be";
    ctx.fillRect(plot.right - 170, plot.top + 6, 16, 4);
    ctx.fillStyle = "#f3ebd8";
    ctx.fillText("V_t(s=0)", plot.right - 146, plot.top + 12);
    ctx.fillStyle = "#d79a4a";
    ctx.fillRect(plot.right - 88, plot.top + 6, 16, 4);
    ctx.fillStyle = "#f3ebd8";
    ctx.fillText("V_t(s=1)", plot.right - 64, plot.top + 12);
  }

  function drawCumChart(cumMwh, cap) {
    const plot = setupCanvas(refs.cumChart);
    const maxValue = Math.max(cap, ...cumMwh);
    drawAxes(plot, [
      { text: "0", y: plot.bottom },
      { text: `${formatNumber(maxValue / 2, 0)} MWh`, y: plot.top + (plot.bottom - plot.top) / 2 },
      { text: `${formatNumber(maxValue, 0)} MWh`, y: plot.top }
    ]);
    drawDaySeparators(plot, cumMwh.length);
    drawLineSeries(plot, cumMwh, "#83c5be", 0, maxValue, 2.5);

    const { ctx, left, right, top, bottom } = plot;
    const capY = bottom - (cap / Math.max(maxValue, 1)) * (bottom - top);
    ctx.strokeStyle = "#d79a4a";
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(left, capY);
    ctx.lineTo(right, capY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#f3ebd8";
    ctx.fillText(`Cap ${formatNumber(cap, 0)} MWh`, right - 130, capY - 8);
  }

  function renderGraphs(result) {
    drawProfitChart(result.caseCards);
    drawMarginsChart(result.flat.margins, result.cases.base.statuses);
    drawValuesChart(result.cases.base.valuesS0, result.cases.base.valuesS1);
    drawCumChart(result.cases.ext2.cumMwh, result.scenario.parameters.productionCapMwh);
  }

  function matrixToTable(title, values, formatter) {
    const matrix = weekMatrix(values);
    const header = model.DAY_NAMES.map((day) => `<th>${day}</th>`).join("");
    const rows = matrix
      .map((row, hourIndex) => {
        const cells = row.map((value) => `<td>${formatter(value)}</td>`).join("");
        return `<tr><td>H${hourIndex + 1}</td>${cells}</tr>`;
      })
      .join("");

    return `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>${title}</th>
              ${header}
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function renderMatrixView(baseCase) {
    const views = {
      "values-s0": matrixToTable("V_t(s=0)", baseCase.valuesS0, (value) => formatMoney(value)),
      "values-s1": matrixToTable("V_t(s=1)", baseCase.valuesS1, (value) => formatMoney(value)),
      "actions-s0": matrixToTable("x_t(s=0)", baseCase.decisionsS0, (value) => String(value)),
      "actions-s1": matrixToTable("x_t(s=1)", baseCase.decisionsS1, (value) => String(value))
    };
    refs.matrixView.innerHTML = views[state.currentMatrixView];
  }

  function clearCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  function runModel() {
    const scenario = readScenarioFromDom();
    const result = model.computeScenario(scenario, validationData);
    state.result = result;

    renderDiagnostics(result);

    if (result.diagnostics.errors.length) {
      refs.validationCard.innerHTML = `<div class="status-warning">Fix the input errors before running the model.</div>`;
      refs.caseCards.innerHTML = "";
      refs.comparisonTable.innerHTML = "";
      refs.scheduleWrap.innerHTML = "";
      refs.mcSummary.innerHTML = "";
      refs.matrixView.innerHTML = "";
      clearCanvas(refs.mcChart);
      clearCanvas(refs.profitChart);
      clearCanvas(refs.marginsChart);
      clearCanvas(refs.valuesChart);
      clearCanvas(refs.cumChart);
      return;
    }

    renderValidationCard(result.validation);
    renderCaseCards(result.caseCards);
    renderComparisonTable(result.caseCards);
    renderSchedules(result);
    renderMonteCarlo(result.cases.ext3);
    renderGraphs(result);
    renderMatrixView(result.cases.base);
  }

  function resetDefaults() {
    populateScenarioIntoDom(defaultScenario);
    runModel();
  }

  function exportScenario() {
    const scenario = readScenarioFromDom();
    const payload = JSON.stringify(scenario, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "dispatch-scenario.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function bindEvents() {
    refs.runModel.addEventListener("click", runModel);
    refs.resetDefaults.addEventListener("click", resetDefaults);
    refs.exportJson.addEventListener("click", exportScenario);

    document.querySelectorAll(".mini-toggle").forEach((button) => {
      button.addEventListener("click", () => {
        state.currentMatrixView = button.dataset.view;
        document.querySelectorAll(".mini-toggle").forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        if (state.result && state.result.cases && state.result.cases.base) {
          renderMatrixView(state.result.cases.base);
        }
      });
    });
  }

  function init() {
    populateScenarioIntoDom(defaultScenario);
    bindEvents();
    runModel();
  }

  init();
})();
