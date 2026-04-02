(function () {
  const model = window.DispatchModel;

  const state = {
    scenario: model.deepClone(window.DEFAULT_SCENARIO),
    validationData: model.deepClone(window.VALIDATION_24H),
    result: null,
    activeTab: "base",
    currentMatrixView: "values-s0"
  };

  const refs = {
    runModel: document.getElementById("run-model"),
    resetDefaults: document.getElementById("reset-defaults"),
    exportJson: document.getElementById("export-json"),
    validationSummary: document.getElementById("validation-summary"),
    diagnostics: document.getElementById("diagnostics"),
    overviewCards: document.getElementById("overview-cards"),
    overviewTable: document.getElementById("overview-table"),
    profitChart: document.getElementById("profit-chart"),
    tabContent: document.getElementById("tab-content"),
    tabButtons: Array.from(document.querySelectorAll(".tab-button"))
  };

  const parameterFields = [
    { key: "minRuntimeHours", label: "Minimum runtime (hours)", step: "1" },
    { key: "productionCapMwh", label: "Production cap (MWh)", step: "50" },
    { key: "productionStepMwh", label: "Production step (MWh)", step: "50" },
    { key: "mcIterations", label: "Monte Carlo iterations", step: "100" },
    { key: "seed", label: "Random seed", step: "1" }
  ];

  const currencyFormatter = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2
  });

  const numberFormatter = new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 2
  });

  function formatMoney(value) {
    return value == null || Number.isNaN(value) ? "n/a" : currencyFormatter.format(value);
  }

  function formatNumber(value, digits) {
    if (value == null || Number.isNaN(value)) {
      return "n/a";
    }
    if (digits == null) {
      return numberFormatter.format(value);
    }
    return model.round(value, digits).toLocaleString("fr-FR");
  }

  function metricCard(label, value, subvalue) {
    return `
      <article class="metric-card">
        <span class="label">${label}</span>
        <span class="value">${value}</span>
        ${subvalue ? `<span class="subvalue">${subvalue}</span>` : ""}
      </article>
    `;
  }

  function tableMarkup(headers, rows) {
    const head = headers.map((item) => `<th>${item}</th>`).join("");
    const body = rows
      .map((row) => {
        return `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
      })
      .join("");
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    `;
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

  function scheduleMarkup(title, subtitle, statuses) {
    const header = model.DAY_NAMES.map((day) => `<div class="schedule-head">${day}</div>`).join("");
    const body = weekMatrix(statuses)
      .map((row, hourIndex) => {
        const cells = row
          .map((status) => {
            const cls = status === "ON*" ? "status-start" : status === "ON" ? "status-on" : "status-off";
            return `<div class="schedule-cell ${cls}">${status}</div>`;
          })
          .join("");
        return `<div class="schedule-head schedule-hour">H${hourIndex + 1}</div>${cells}`;
      })
      .join("");

    return `
      <section class="content-card">
        <div class="figure-head">
          <h3>${title}</h3>
          <p>${subtitle}</p>
        </div>
        <div class="schedule-grid">
          <div class="schedule-head">Hour</div>
          ${header}
          ${body}
        </div>
      </section>
    `;
  }

  function weeklyEditorMarkup(metricKey, label, valuesByDay, step) {
    const head = model.DAY_NAMES.map((day) => `<th>${day}</th>`).join("");
    const rows = Array.from({ length: 24 }, (_, hourIndex) => {
      const cells = valuesByDay
        .map((dayData, dayIndex) => {
          return `
            <td>
              <input
                type="number"
                step="${step}"
                data-metric="${metricKey}"
                data-day="${dayIndex}"
                data-hour="${hourIndex}"
                value="${dayData[metricKey][hourIndex]}"
              />
            </td>
          `;
        })
        .join("");
      return `<tr><td>H${hourIndex + 1}</td>${cells}</tr>`;
    }).join("");

    return `
      <details class="editor-card" open>
        <summary>${label}</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Hour</th>${head}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </details>
    `;
  }

  function stochasticEditorMarkup(rows) {
    const body = rows
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

    return `
      <details class="editor-card">
        <summary>Sunday stochastic demand scenarios</summary>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hour</th>
                <th>D1</th>
                <th>P1</th>
                <th>D2</th>
                <th>P2</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </details>
    `;
  }

  function renderValidation(validation) {
    if (!validation) {
      refs.validationSummary.innerHTML = `<div class="status-warning">Validation data unavailable.</div>`;
      return;
    }

    refs.validationSummary.innerHTML = `
      <div class="validation-grid">
        <div class="validation-row"><span>Calculated V1(s=0)</span><strong>${formatMoney(validation.calculatedV1s0)}</strong></div>
        <div class="validation-row"><span>Reference V1(s=0)</span><strong>${formatMoney(validation.referenceV1s0)}</strong></div>
        <div class="validation-row"><span>Absolute gap</span><strong>${formatNumber(validation.absoluteGap, 6)}</strong></div>
        <div class="validation-row"><span>x_t(s=0) match</span><strong>${validation.s0DecisionMatch ? "Yes" : "No"}</strong></div>
      </div>
    `;
  }

  function renderDiagnostics(result) {
    const blocks = [];
    if (!result.diagnostics.errors.length) {
      blocks.push(`<div class="status-ok">No blocking input errors detected.</div>`);
    }
    result.diagnostics.errors.forEach((message) => blocks.push(`<div class="status-error">${message}</div>`));
    result.diagnostics.warnings.forEach((message) => blocks.push(`<div class="status-warning">${message}</div>`));
    refs.diagnostics.innerHTML = blocks.join("");
  }

  function renderOverview(result) {
    refs.overviewCards.innerHTML = result.caseCards
      .map((card) => {
        return metricCard(
          card.label,
          formatMoney(card.profit),
          `${card.production == null ? "Production n/a" : `Production ${formatNumber(card.production, 0)} MWh`} / ${
            card.startups == null ? "Startups n/a" : `${card.startups} startups`
          }`
        );
      })
      .join("");

    refs.overviewTable.innerHTML = tableMarkup(
      ["Case", "Profit", "MWh", "Startups", "Delta vs base"],
      result.caseCards.map((card) => [
        card.label,
        formatMoney(card.profit),
        card.production == null ? "n/a" : formatNumber(card.production, 0),
        card.startups == null ? "n/a" : String(card.startups),
        formatMoney(card.deltaVsBase)
      ])
    );
  }

  function setupCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fbf7f0";
    ctx.fillRect(0, 0, width, height);
    return { ctx, width, height, left: 58, right: width - 24, top: 24, bottom: height - 38 };
  }

  function drawAxes(plot, yLabels) {
    const { ctx, left, right, top, bottom } = plot;
    ctx.strokeStyle = "#cab9a5";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    ctx.fillStyle = "#6d6258";
    ctx.font = '12px "Segoe UI"';
    yLabels.forEach((label) => {
      ctx.fillText(label.text, 10, label.y + 4);
      ctx.strokeStyle = "#ece2d6";
      ctx.beginPath();
      ctx.moveTo(left, label.y);
      ctx.lineTo(right, label.y);
      ctx.stroke();
    });
  }

  function drawDaySeparators(plot, pointsCount) {
    const { ctx, left, right, top, bottom } = plot;
    const plotWidth = right - left;
    for (let day = 1; day < 7; day += 1) {
      const x = left + (day * 24 / Math.max(pointsCount - 1, 1)) * plotWidth;
      ctx.strokeStyle = "#e8ddd1";
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.fillStyle = "#8a5a2f";
      ctx.fillText(model.DAY_NAMES[day], x + 4, top + 12);
    }
  }

  function drawLine(plot, values, color, minValue, maxValue, width) {
    const { ctx, left, right, top, bottom } = plot;
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    const range = Math.max(maxValue - minValue, 1e-9);

    ctx.strokeStyle = color;
    ctx.lineWidth = width;
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

  function drawProfitChart(canvas, caseCards) {
    const plot = setupCanvas(canvas);
    const { ctx, left, right, top, bottom } = plot;
    const values = caseCards.map((card) => card.profit);
    const maxValue = Math.max(...values) * 1.05;
    const minValue = Math.min(...values) * 0.95;
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    const range = Math.max(maxValue - minValue, 1);
    const barWidth = plotWidth / values.length * 0.56;

    drawAxes(plot, [
      { text: formatMoney(minValue), y: bottom },
      { text: formatMoney((minValue + maxValue) / 2), y: top + plotHeight / 2 },
      { text: formatMoney(maxValue), y: top }
    ]);

    values.forEach((value, index) => {
      const x = left + (index + 0.5) * (plotWidth / values.length) - barWidth / 2;
      const y = bottom - ((value - minValue) / range) * plotHeight;
      ctx.fillStyle = index === 0 ? "#2e7d64" : "#8a5a2f";
      ctx.fillRect(x, y, barWidth, bottom - y);
      ctx.fillStyle = "#6d6258";
      ctx.fillText(caseCards[index].label, x, bottom + 18);
    });
  }

  function drawMarginsChart(canvas, margins, statuses) {
    const plot = setupCanvas(canvas);
    const { ctx, left, right, top, bottom } = plot;
    const minValue = Math.min(...margins);
    const maxValue = Math.max(...margins);
    const zeroY = bottom - ((0 - minValue) / Math.max(maxValue - minValue, 1e-9)) * (bottom - top);
    const plotWidth = right - left;

    drawAxes(plot, [
      { text: formatNumber(minValue, 2), y: bottom },
      { text: "0", y: zeroY },
      { text: formatNumber(maxValue, 2), y: top }
    ]);

    statuses.forEach((status, index) => {
      if (status === ".") return;
      const x0 = left + (index / margins.length) * plotWidth;
      const x1 = left + ((index + 1) / margins.length) * plotWidth;
      ctx.fillStyle = status === "ON*" ? "rgba(197,139,58,0.18)" : "rgba(46,125,100,0.12)";
      ctx.fillRect(x0, top, Math.max(1, x1 - x0), bottom - top);
    });

    drawDaySeparators(plot, margins.length);
    ctx.strokeStyle = "#cdbca8";
    ctx.beginPath();
    ctx.moveTo(left, zeroY);
    ctx.lineTo(right, zeroY);
    ctx.stroke();
    drawLine(plot, margins, "#8a5a2f", minValue, maxValue, 2.2);
  }

  function drawValuesChart(canvas, valuesS0, valuesS1) {
    const plot = setupCanvas(canvas);
    const allValues = valuesS0.concat(valuesS1);
    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);
    drawAxes(plot, [
      { text: formatMoney(minValue), y: plot.bottom },
      { text: formatMoney((minValue + maxValue) / 2), y: plot.top + (plot.bottom - plot.top) / 2 },
      { text: formatMoney(maxValue), y: plot.top }
    ]);
    drawDaySeparators(plot, valuesS0.length);
    drawLine(plot, valuesS0, "#2e7d64", minValue, maxValue, 2.4);
    drawLine(plot, valuesS1, "#c58b3a", minValue, maxValue, 2.2);

    const { ctx, right, top } = plot;
    ctx.fillStyle = "#2e7d64";
    ctx.fillRect(right - 180, top + 6, 16, 4);
    ctx.fillStyle = "#6d6258";
    ctx.fillText("V_t(s=0)", right - 156, top + 12);
    ctx.fillStyle = "#c58b3a";
    ctx.fillRect(right - 90, top + 6, 16, 4);
    ctx.fillStyle = "#6d6258";
    ctx.fillText("V_t(s=1)", right - 66, top + 12);
  }

  function drawCumChart(canvas, cumMwh, cap) {
    const plot = setupCanvas(canvas);
    const maxValue = Math.max(cap, ...cumMwh);
    drawAxes(plot, [
      { text: "0", y: plot.bottom },
      { text: `${formatNumber(maxValue / 2, 0)} MWh`, y: plot.top + (plot.bottom - plot.top) / 2 },
      { text: `${formatNumber(maxValue, 0)} MWh`, y: plot.top }
    ]);
    drawDaySeparators(plot, cumMwh.length);
    drawLine(plot, cumMwh, "#2e7d64", 0, maxValue, 2.5);

    const { ctx, left, right, top, bottom } = plot;
    const capY = bottom - (cap / Math.max(maxValue, 1)) * (bottom - top);
    ctx.strokeStyle = "#c58b3a";
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.moveTo(left, capY);
    ctx.lineTo(right, capY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#6d6258";
    ctx.fillText(`Cap ${formatNumber(cap, 0)} MWh`, right - 130, capY - 8);
  }

  function drawHistogram(canvas, histogram, exactExpected) {
    const plot = setupCanvas(canvas);
    const { ctx, left, right, top, bottom, height } = plot;
    const plotWidth = right - left;
    const plotHeight = bottom - top;
    const maxCount = Math.max(...histogram.map((bin) => bin.count), 1);
    const minX = histogram[0].x0;
    const maxX = histogram[histogram.length - 1].x1;

    drawAxes(plot, [
      { text: "0", y: bottom },
      { text: String(Math.round(maxCount / 2)), y: top + plotHeight / 2 },
      { text: String(maxCount), y: top }
    ]);

    histogram.forEach((bin, index) => {
      const x0 = left + (index / histogram.length) * plotWidth + 2;
      const width = plotWidth / histogram.length - 4;
      const barHeight = (bin.count / maxCount) * plotHeight;
      const y = bottom - barHeight;
      ctx.fillStyle = "#8a5a2f";
      ctx.fillRect(x0, y, width, barHeight);
    });

    const exactX = left + ((exactExpected - minX) / Math.max(maxX - minX, 1)) * plotWidth;
    ctx.strokeStyle = "#2e7d64";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(exactX, top);
    ctx.lineTo(exactX, bottom);
    ctx.stroke();

    ctx.fillStyle = "#6d6258";
    ctx.fillText(formatMoney(minX), left, height - 14);
    ctx.fillText(formatMoney(maxX), right - 90, height - 14);
    ctx.fillText("Exact Bellman EV", Math.min(right - 110, exactX + 8), top + 12);
  }

  function matrixTableMarkup(title, values, formatter) {
    return `
      <section class="content-card">
        <div class="figure-head">
          <h3>${title}</h3>
          <p>Tableau 24 x 7 pour le cas de base.</p>
        </div>
        ${tableMarkup(
          ["Hour"].concat(model.DAY_NAMES),
          weekMatrix(values).map((row, hourIndex) => [`H${hourIndex + 1}`].concat(row.map((value) => formatter(value))))
        )}
      </section>
    `;
  }

  function renderBaseTab(result) {
    const base = result.cases.base;
    refs.tabContent.innerHTML = `
      <section class="scenario-head">
        <p class="section-kicker">Cas 1</p>
        <h2>Probleme de base sur 168 heures</h2>
        <p class="narrative">
          Ce premier onglet reprend le modele classique de l'enonce : une centrale binaire on/off, une demande
          deterministe, des couts de demarrage variables et une condition terminale imposant une centrale eteinte a la fin.
        </p>
      </section>

      <section class="metric-grid">
        ${metricCard("Profit optimal", formatMoney(base.summary.profit), "Valeur V1(0)")}
        ${metricCard("Production", `${formatNumber(base.summary.production, 0)} MWh`, "Production hebdomadaire")}
        ${metricCard("Demarrages", String(base.summary.startups), "Nombre de startups")}
      </section>

      <div class="two-col">
        <section class="figure-card">
          <div class="figure-head">
            <h3>Marges horaires et planning optimal</h3>
            <p>Les bandes colorees marquent les heures ON du planning optimal.</p>
          </div>
          <canvas id="base-margins-chart" width="960" height="320"></canvas>
        </section>

        <section class="figure-card">
          <div class="figure-head">
            <h3>Fonctions de valeur</h3>
            <p>Evolution de V_t(s=0) et V_t(s=1) sur la semaine.</p>
          </div>
          <canvas id="base-values-chart" width="960" height="320"></canvas>
        </section>
      </div>

      ${scheduleMarkup("Planning optimal", "Representation 24 x 7 du statut ON/OFF du cas de base.", base.statuses)}

      <section class="content-card">
        <div class="figure-head">
          <h3>Tables du cas de base</h3>
          <p>Decisions optimales et fonctions de valeur, organisees comme dans un rendu de projet.</p>
        </div>
        <div class="table-switcher">
          <button class="mini-toggle ${state.currentMatrixView === "values-s0" ? "is-active" : ""}" data-view="values-s0">V_t(s=0)</button>
          <button class="mini-toggle ${state.currentMatrixView === "values-s1" ? "is-active" : ""}" data-view="values-s1">V_t(s=1)</button>
          <button class="mini-toggle ${state.currentMatrixView === "actions-s0" ? "is-active" : ""}" data-view="actions-s0">x_t(s=0)</button>
          <button class="mini-toggle ${state.currentMatrixView === "actions-s1" ? "is-active" : ""}" data-view="actions-s1">x_t(s=1)</button>
        </div>
        <div id="base-matrix-slot"></div>
      </section>
    `;

    drawMarginsChart(document.getElementById("base-margins-chart"), result.flat.margins, base.statuses);
    drawValuesChart(document.getElementById("base-values-chart"), base.valuesS0, base.valuesS1);

    const views = {
      "values-s0": matrixTableMarkup("V_t(s=0)", base.valuesS0, (value) => formatMoney(value)),
      "values-s1": matrixTableMarkup("V_t(s=1)", base.valuesS1, (value) => formatMoney(value)),
      "actions-s0": matrixTableMarkup("x_t(s=0)", base.decisionsS0, (value) => String(value)),
      "actions-s1": matrixTableMarkup("x_t(s=1)", base.decisionsS1, (value) => String(value))
    };
    document.getElementById("base-matrix-slot").innerHTML = views[state.currentMatrixView];
  }

  function renderExt1Tab(result) {
    const base = result.cases.base.summary;
    const ext1 = result.cases.ext1.summary;
    refs.tabContent.innerHTML = `
      <section class="scenario-head">
        <p class="section-kicker">Cas 2</p>
        <h2>Extension 1 : duree minimale de fonctionnement</h2>
        <p class="narrative">
          La centrale doit rester allumee au moins ${result.scenario.parameters.minRuntimeHours} heures apres chaque demarrage.
          Cette contrainte change l'espace d'etats et reduit la flexibilite de pilotage.
        </p>
      </section>

      <section class="metric-grid">
        ${metricCard("Profit extension 1", formatMoney(ext1.profit), `${formatMoney(ext1.profit - base.profit)} vs base`)}
        ${metricCard("Production", `${formatNumber(ext1.production, 0)} MWh`, `${formatNumber(ext1.production - base.production, 0)} MWh vs base`)}
        ${metricCard("Demarrages", String(ext1.startups), `${ext1.startups - base.startups} vs base`)}
      </section>

      ${scheduleMarkup(
        "Planning avec minimum runtime",
        "Le planning fait apparaitre des blocs ON plus engages, car chaque allumage impose une duree minimale.",
        result.cases.ext1.statuses
      )}

      <section class="content-card">
        <div class="figure-head">
          <h3>Lecture du resultat</h3>
          <p>
            Le modele evite certains demarrages courts et accepte parfois des heures moins rentables pour respecter la contrainte
            de duree minimale. L'effet principal est une baisse du profit et une reduction du nombre total de startups.
          </p>
        </div>
      </section>
    `;
  }

  function renderExt2Tab(result) {
    const base = result.cases.base.summary;
    const ext2 = result.cases.ext2.summary;
    refs.tabContent.innerHTML = `
      <section class="scenario-head">
        <p class="section-kicker">Cas 3</p>
        <h2>Extension 2 : plafond de production</h2>
        <p class="narrative">
          La production totale ne peut pas depasser ${formatNumber(result.scenario.parameters.productionCapMwh, 0)} MWh.
          Le modele doit donc arbitrer non seulement heure par heure, mais aussi en tenant compte du cumul deja consomme.
        </p>
      </section>

      <section class="metric-grid">
        ${metricCard("Profit extension 2", formatMoney(ext2.profit), `${formatMoney(ext2.profit - base.profit)} vs base`)}
        ${metricCard("Production", `${formatNumber(ext2.production, 0)} MWh`, `Cap ${formatNumber(result.scenario.parameters.productionCapMwh, 0)} MWh`)}
        ${metricCard("Demarrages", String(ext2.startups), `${ext2.startups - base.startups} vs base`)}
      </section>

      <div class="two-col">
        ${scheduleMarkup("Planning avec plafond", "Le planning montre quelles heures sont sacrifiees pour rester sous le plafond.", result.cases.ext2.statuses)}
        <section class="figure-card">
          <div class="figure-head">
            <h3>Cumul de production</h3>
            <p>Le trait pointille represente le plafond hebdomadaire.</p>
          </div>
          <canvas id="ext2-cum-chart" width="960" height="320"></canvas>
        </section>
      </div>
    `;

    drawCumChart(
      document.getElementById("ext2-cum-chart"),
      result.cases.ext2.cumMwh,
      result.scenario.parameters.productionCapMwh
    );
  }

  function renderExt3Tab(result) {
    const ext3 = result.cases.ext3;
    refs.tabContent.innerHTML = `
      <section class="scenario-head">
        <p class="section-kicker">Cas 4</p>
        <h2>Extension 3 : demande stochastique le dimanche</h2>
        <p class="narrative">
          Le dimanche devient aleatoire. La decision optimale reste une politique de dispatch, mais la valeur s'exprime en esperance
          et se compare a une approximation basee sur la demande moyenne.
        </p>
      </section>

      <section class="mc-grid">
        ${metricCard("Bellman exact", formatMoney(ext3.expectedProfit), "Esperance du modele stochastique")}
        ${metricCard("Proxy avec E[D]", formatMoney(ext3.expectedDemandProxyProfit), "Modele deterministe equivalent")}
        ${metricCard("Monte Carlo mean", formatMoney(ext3.monteCarlo.mean), `${ext3.monteCarlo.iterations} simulations`)}
        ${metricCard("Std dev", formatMoney(ext3.monteCarlo.stdDev), "Dispersion des profits")}
        ${metricCard("P05", formatMoney(ext3.monteCarlo.p05), "Quantile 5%")}
        ${metricCard("P95", formatMoney(ext3.monteCarlo.p95), "Quantile 95%")}
      </section>

      <section class="figure-card">
        <div class="figure-head">
          <h3>Distribution Monte Carlo</h3>
          <p>
            L'histogramme montre la dispersion des profits simules sous la politique optimale stochastique.
            La ligne verticale represente l'esperance exacte obtenue par Bellman.
          </p>
        </div>
        <canvas id="ext3-histogram" width="960" height="320"></canvas>
      </section>

      <section class="content-card">
        <div class="figure-head">
          <h3>Lecture du resultat</h3>
          <p>
            Ici, on ne presente pas un planning unique pour le dimanche, car la politique depend de la realisation de la demande.
            Le point important est l'ecart entre le modele stochastique exact et le proxy base sur E[D].
          </p>
        </div>
      </section>
    `;

    drawHistogram(document.getElementById("ext3-histogram"), ext3.monteCarlo.histogram, ext3.expectedProfit);
  }

  function renderInputsTab(result) {
    refs.tabContent.innerHTML = `
      <section class="scenario-head">
        <p class="section-kicker">Reglages</p>
        <h2>Donnees d'entree et parametres</h2>
        <p class="narrative">
          Cette section permet de modifier les hypotheses du projet. Les valeurs chargees par defaut correspondent au jeu de donnees
          du projet. Apres edition, utilise le bouton "Recalculer" pour relancer tout le modele.
        </p>
      </section>

      <section class="content-card">
        <div class="figure-head">
          <h3>Parametres globaux</h3>
          <p>Les extensions utilisent ces reglages communs.</p>
        </div>
        <div class="parameter-grid">
          ${parameterFields
            .map((field) => {
              return `
                <div class="parameter-field">
                  <label for="param-${field.key}">${field.label}</label>
                  <input id="param-${field.key}" type="number" step="${field.step}" data-param="${field.key}" value="${state.scenario.parameters[field.key]}" />
                </div>
              `;
            })
            .join("")}
        </div>
      </section>

      <section class="editor-stack">
        ${weeklyEditorMarkup("margins", "Margins by hour and day", state.scenario.base, "0.01")}
        ${weeklyEditorMarkup("demands", "Deterministic demands by hour and day", state.scenario.base, "50")}
        ${weeklyEditorMarkup("startups", "Startup costs by hour and day", state.scenario.base, "100")}
        ${stochasticEditorMarkup(state.scenario.stochasticSunday)}
      </section>

      <section class="content-card">
        <div class="figure-head">
          <h3>Current scenario summary</h3>
          <p>
            Base profit: ${formatMoney(result.cases.base.summary.profit)} /
            Ext 1: ${formatMoney(result.cases.ext1.summary.profit)} /
            Ext 2: ${formatMoney(result.cases.ext2.summary.profit)} /
            Ext 3 exact EV: ${formatMoney(result.cases.ext3.expectedProfit)}
          </p>
        </div>
      </section>
    `;
  }

  function renderActiveTab() {
    const result = state.result;
    if (!result || result.diagnostics.errors.length) {
      refs.tabContent.innerHTML = `
        <section class="content-card">
          <div class="figure-head">
            <h3>Input error</h3>
            <p>Fix the blocking diagnostics before the scenario tabs can be rendered.</p>
          </div>
        </section>
      `;
      return;
    }

    if (state.activeTab === "base") {
      renderBaseTab(result);
    } else if (state.activeTab === "ext1") {
      renderExt1Tab(result);
    } else if (state.activeTab === "ext2") {
      renderExt2Tab(result);
    } else if (state.activeTab === "ext3") {
      renderExt3Tab(result);
    } else {
      renderInputsTab(result);
    }
  }

  function computeAndRender() {
    state.result = model.computeScenario(state.scenario, state.validationData);
    renderValidation(state.result.validation);
    renderDiagnostics(state.result);
    if (!state.result.diagnostics.errors.length) {
      renderOverview(state.result);
      drawProfitChart(refs.profitChart, state.result.caseCards);
    } else {
      refs.overviewCards.innerHTML = "";
      refs.overviewTable.innerHTML = "";
      const plot = setupCanvas(refs.profitChart);
      plot.ctx.fillStyle = "#6d6258";
      plot.ctx.fillText("Fix input errors to compute scenario comparison.", 70, 80);
    }
    renderActiveTab();
  }

  function updateScenarioFromInput(target) {
    if (target.dataset.param) {
      state.scenario.parameters[target.dataset.param] = Number(target.value);
      return;
    }
    if (target.dataset.metric) {
      const day = Number(target.dataset.day);
      const hour = Number(target.dataset.hour);
      state.scenario.base[day][target.dataset.metric][hour] = Number(target.value);
      return;
    }
    if (target.dataset.stoch) {
      const hour = Number(target.dataset.hour);
      state.scenario.stochasticSunday[hour][target.dataset.stoch] = Number(target.value);
    }
  }

  function exportScenario() {
    const payload = JSON.stringify(state.scenario, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "dispatch-scenario.json";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function bindEvents() {
    refs.runModel.addEventListener("click", computeAndRender);

    refs.resetDefaults.addEventListener("click", () => {
      state.scenario = model.deepClone(window.DEFAULT_SCENARIO);
      computeAndRender();
    });

    refs.exportJson.addEventListener("click", exportScenario);

    refs.tabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.activeTab = button.dataset.tab;
        refs.tabButtons.forEach((item) => item.classList.remove("is-active"));
        button.classList.add("is-active");
        renderActiveTab();
      });
    });

    refs.tabContent.addEventListener("click", (event) => {
      const button = event.target.closest(".mini-toggle");
      if (!button) return;
      state.currentMatrixView = button.dataset.view;
      renderActiveTab();
    });

    refs.tabContent.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      updateScenarioFromInput(target);
    });
  }

  bindEvents();
  computeAndRender();
})();
