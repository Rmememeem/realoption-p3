#!/usr/bin/env python3
"""
============================================================================
 PROJET 3 : Programme Dynamique pour le Dispatch d'une Centrale Électrique
 IFP School - Real Options - Mars/Avril 2026
============================================================================

 Ce script résout le problème de dispatch (allumer/éteindre une centrale)
 en utilisant la Programmation Dynamique (induction rétrograde / backward
 induction).

 Structure du fichier :
   1. Lecture des données (Project3data.xls)
   2. Problème de base : DP sur 168 heures (7 jours x 24h)
   3. Validation sur le cas 24h du cours
   4. Extension 1 : Durée minimale de fonctionnement (10h)
   5. Extension 2 : Plafond de production hebdomadaire (16 500 MWh)
   6. Extension 3 : Demande stochastique le dimanche (+ plafond)
"""

import numpy as np
import pandas as pd
from collections import defaultdict

# ============================================================================
# 1. LECTURE DES DONNÉES
# ============================================================================

def load_data(filepath="Project3data.xls"):
    """
    Charge les données du fichier Excel.
    Retourne trois tableaux 1D indexés de 0 à 167 (168 heures) :
      - margins[t]  : marge en €/MWh
      - demands[t]  : demande en MW
      - startups[t] : coût de démarrage en €
    Et les données stochastiques pour le dimanche (Extension 3).
    """
    # --- Feuille WeeklySchedule ---
    df = pd.read_excel(filepath, sheet_name="WeeklySchedule", header=None)

    # Les jours sont dans les colonnes 1-7 (Lun-Dim) pour les marges,
    # colonnes 10-16 pour la demande, colonnes 19-25 pour les coûts de démarrage.
    # Les lignes de données vont de l'index 2 à 25 (heures 1-24).

    days = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
    margins = np.zeros(168)
    demands = np.zeros(168)
    startups = np.zeros(168)

    for day_idx in range(7):  # 0=Lun, ..., 6=Dim
        for hour_idx in range(24):  # 0-23
            row = hour_idx + 2  # les données commencent à la ligne 2
            t = day_idx * 24 + hour_idx  # indice global 0-167

            margins[t]  = float(df.iloc[row, 1 + day_idx])      # colonnes 1-7
            demands[t]  = float(df.iloc[row, 10 + day_idx])     # colonnes 10-16
            startups[t] = float(df.iloc[row, 19 + day_idx])     # colonnes 19-25

    # --- Feuille StochasticDemand (pour Extension 3) ---
    df_stoch = pd.read_excel(filepath, sheet_name="StochasticDemand", header=None)

    stoch_demand = []  # liste de 24 tuples: [(D1, p1, D2, p2), ...]
    for hour_idx in range(24):
        row = hour_idx + 2
        D1 = float(df_stoch.iloc[row, 1])
        p1 = float(df_stoch.iloc[row, 2])
        D2 = float(df_stoch.iloc[row, 3])
        p2 = float(df_stoch.iloc[row, 4])
        stoch_demand.append((D1, p1, D2, p2))

    return margins, demands, startups, stoch_demand


def load_24h_validation(filepath="Project3code_Student.xlsm"):
    """
    Charge les données du cas 24h résolu en cours pour validation.
    """
    df = pd.read_excel(filepath, sheet_name="24hours", header=None)

    margins_24  = np.zeros(24)
    demands_24  = np.full(24, 100.0)   # demande constante 100 MW
    startups_24 = np.full(24, 400.0)   # coût de démarrage fixe 400 €

    # Valeurs de référence (V et x*)
    ref_V_s0 = np.zeros(25)  # V_t(s=0) pour t=1..25
    ref_V_s1 = np.zeros(25)
    ref_x_s0 = np.zeros(25)
    ref_x_s1 = np.zeros(25)

    for i in range(24):
        margins_24[i] = float(df.iloc[i + 1, 1])  # colonne B, lignes 2-25

    for i in range(25):
        ref_x_s0[i] = float(df.iloc[i + 1, 6]) if pd.notna(df.iloc[i + 1, 6]) else 0
        ref_x_s1[i] = float(df.iloc[i + 1, 7]) if pd.notna(df.iloc[i + 1, 7]) else 0
        ref_V_s0[i] = float(df.iloc[i + 1, 8]) if pd.notna(df.iloc[i + 1, 8]) else 0
        ref_V_s1[i] = float(df.iloc[i + 1, 9]) if pd.notna(df.iloc[i + 1, 9]) else np.nan

    return margins_24, demands_24, startups_24, ref_V_s0, ref_V_s1, ref_x_s0, ref_x_s1


# ============================================================================
# 2. PROBLÈME DE BASE : DP avec état = {0, 1}
# ============================================================================

def solve_base_dp(margins, demands, startups):
    """
    Résout le problème de dispatch par induction rétrograde.

    État : s_t ∈ {0, 1}  (0 = éteinte, 1 = allumée)

    Équation de Bellman :
      V_t(s_t) = max_x { C(x, s_t, m_t) + V_{t+1}(s_{t+1}) }

    Condition terminale : V_{T+1}(0) = 0,  V_{T+1}(1) = -∞

    Retourne :
      V[t][s]  : fonction de valeur (t=0..T, s=0,1)
      X[t][s]  : décision optimale
    """
    T = len(margins)  # nombre de périodes (168 ou 24)

    # Tableaux de résultats : V[t][s] et X[t][s]
    # t va de 0 à T (T+1 valeurs), s ∈ {0, 1}
    V = np.zeros((T + 1, 2))
    X = np.zeros((T, 2), dtype=int)  # décisions : 0, 1, ou -1

    # --- Condition terminale (t = T, i.e. après la dernière heure) ---
    # Le cas 24h de référence suppose qu'après l'horizon, la valeur de continuation
    # est nulle quel que soit l'état; on peut donc s'éteindre sans pénalité à T+1.
    V[T][0] = 0.0
    V[T][1] = 0.0

    # --- Boucle rétrograde : de t = T-1 à t = 0 ---
    for t in range(T - 1, -1, -1):
        m = margins[t]
        D = demands[t]
        f = startups[t]

        # === Cas s_t = 0 (centrale éteinte) ===
        # Option 1 : rester éteinte → récompense = 0, s_{t+1} = 0
        val_stay_off = 0.0 + V[t + 1][0]

        # Option 2 : allumer → récompense = m*D - f, s_{t+1} = 1
        val_turn_on = m * D - f + V[t + 1][1]

        if val_turn_on > val_stay_off:
            V[t][0] = val_turn_on
            X[t][0] = 1   # décision : allumer
        else:
            V[t][0] = val_stay_off
            X[t][0] = 0   # décision : rester éteinte

        # === Cas s_t = 1 (centrale allumée) ===
        # Option 1 : rester allumée → récompense = m*D, s_{t+1} = 1
        val_stay_on = m * D + V[t + 1][1]

        # Option 2 : éteindre → récompense = 0, s_{t+1} = 0
        val_turn_off = 0.0 + V[t + 1][0]

        if val_stay_on >= val_turn_off:
            V[t][1] = val_stay_on
            X[t][1] = 0   # décision : rester allumée
        else:
            V[t][1] = val_turn_off
            X[t][1] = -1  # décision : éteindre

    return V, X


def extract_schedule(X, s0=0):
    """
    À partir des décisions optimales X[t][s], simule la trajectoire
    en partant de l'état initial s0 (0 = éteinte).
    Retourne le vecteur d'état s[t] pour chaque période.
    """
    T = X.shape[0]
    states = np.zeros(T + 1, dtype=int)
    decisions = np.zeros(T, dtype=int)
    states[0] = s0

    for t in range(T):
        s = states[t]
        x = X[t][s]
        decisions[t] = x

        if s == 0 and x == 1:
            states[t + 1] = 1  # allumage
        elif s == 0 and x == 0:
            states[t + 1] = 0  # reste éteinte
        elif s == 1 and x == 0:
            states[t + 1] = 1  # reste allumée
        elif s == 1 and x == -1:
            states[t + 1] = 0  # extinction
        else:
            states[t + 1] = s  # sécurité

    return states, decisions


# ============================================================================
# 3. EXTENSION 1 : Durée minimale de fonctionnement (10 heures)
# ============================================================================

def solve_ext1_min_runtime(margins, demands, startups, min_hours=10):
    """
    Extension 1 : Si la centrale est allumée, elle doit rester allumée
    au moins `min_hours` heures consécutives.

    Nouvel état : (on/off, heures_consécutives_allumée)
      - s = 0              : éteinte
      - s = k (1 ≤ k < 10) : allumée depuis k heures (ne peut pas éteindre)
      - s = 10             : allumée depuis ≥10 heures (peut éteindre)

    Nombre d'états : 1 + min_hours = 11
    """
    T = len(margins)
    n_states = min_hours + 1  # états 0, 1, 2, ..., min_hours

    V = np.full((T + 1, n_states), -1e15)
    X = np.zeros((T, n_states), dtype=int)

    # Condition terminale : seul l'état 0 (éteinte) est autorisé
    V[T][0] = 0.0

    for t in range(T - 1, -1, -1):
        m = margins[t]
        D = demands[t]
        f = startups[t]

        # --- État 0 : éteinte ---
        # Option 1 : rester éteinte
        val_off = 0.0 + V[t + 1][0]
        # Option 2 : allumer → passe à l'état 1 (1 heure de fonctionnement)
        val_on = m * D - f + V[t + 1][min(1, min_hours)]

        if val_on > val_off:
            V[t][0] = val_on
            X[t][0] = 1
        else:
            V[t][0] = val_off
            X[t][0] = 0

        # --- États 1 à min_hours-1 : allumée mais < min_hours heures ---
        # Obligation de rester allumée (pas le choix)
        for k in range(1, min_hours):
            next_k = min(k + 1, min_hours)
            V[t][k] = m * D + V[t + 1][next_k]
            X[t][k] = 0  # forcé de rester allumée

        # --- État min_hours : allumée depuis ≥ min_hours heures ---
        # Option 1 : rester allumée (reste dans l'état min_hours)
        val_stay = m * D + V[t + 1][min_hours]
        # Option 2 : éteindre
        val_off2 = 0.0 + V[t + 1][0]

        if val_stay >= val_off2:
            V[t][min_hours] = val_stay
            X[t][min_hours] = 0
        else:
            V[t][min_hours] = val_off2
            X[t][min_hours] = -1

    return V, X


def extract_schedule_ext1(X, min_hours=10):
    """Simule la trajectoire pour l'Extension 1.
    Retourne states_binary (0/1 pour affichage) et les états détaillés."""
    T = X.shape[0]
    states_detail = np.zeros(T + 1, dtype=int)  # état complet (0..min_hours)
    states_binary = np.zeros(T + 1, dtype=int)   # 0/1 pour affichage
    decisions = np.zeros(T, dtype=int)

    for t in range(T):
        s = states_detail[t]
        x = X[t][s]
        decisions[t] = x

        if s == 0 and x == 1:
            states_detail[t + 1] = 1
        elif s == 0 and x == 0:
            states_detail[t + 1] = 0
        elif 1 <= s < min_hours:
            states_detail[t + 1] = s + 1  # forcé de rester allumée
        elif s == min_hours and x == 0:
            states_detail[t + 1] = min_hours
        elif s == min_hours and x == -1:
            states_detail[t + 1] = 0
        else:
            states_detail[t + 1] = s

        # Pour l'affichage : tout état > 0 = allumée
        states_binary[t + 1] = 1 if states_detail[t + 1] > 0 else 0

    # Aussi fixer states_binary[0] (état initial)
    states_binary[0] = 1 if states_detail[0] > 0 else 0

    return states_binary, decisions


# ============================================================================
# 4. EXTENSION 2 : Plafond de production hebdomadaire (16 500 MWh)
# ============================================================================

def solve_ext2_production_cap(margins, demands, startups, max_mwh=16500):
    """
    Extension 2 : La production totale sur la semaine ne peut pas dépasser
    max_mwh MWh. Si la centrale est allumée, elle produit D_t MWh.

    État : (on/off, production_cumulée)
      - s = 0 (éteinte) ou 1 (allumée)
      - cum = production cumulée en MWh (discrétisée par pas de 50)

    Note importante du sujet : la demande est toujours divisible par 50,
    donc la production cumulée l'est aussi → on peut indexer par cum/50.
    """
    T = len(margins)
    step = 50
    n_cum = max_mwh // step + 1  # 0, 50, 100, ..., 16500 → 331 valeurs

    # V[t][s][c] : valeur optimale à l'heure t, état s, production cumulée c*step
    V = np.full((T + 1, 2, n_cum), -1e15)
    X = np.zeros((T, 2, n_cum), dtype=int)

    # Condition terminale
    for c in range(n_cum):
        V[T][0][c] = 0.0       # éteinte : OK
        V[T][1][c] = -1e15     # allumée : interdit

    for t in range(T - 1, -1, -1):
        m = margins[t]
        D = demands[t]
        f = startups[t]
        d_step = int(D / step)  # nombre de pas de 50 MW

        for c in range(n_cum):
            # === État 0 (éteinte) ===
            val_off = 0.0 + V[t + 1][0][c]

            new_c = c + d_step
            if new_c < n_cum:
                val_on = m * D - f + V[t + 1][1][new_c]
            else:
                val_on = -1e15  # dépassement du plafond

            if val_on > val_off:
                V[t][0][c] = val_on
                X[t][0][c] = 1
            else:
                V[t][0][c] = val_off
                X[t][0][c] = 0

            # === État 1 (allumée) ===
            if new_c < n_cum:
                val_stay = m * D + V[t + 1][1][new_c]
            else:
                val_stay = -1e15

            val_turn_off = 0.0 + V[t + 1][0][c]

            if val_stay >= val_turn_off:
                V[t][1][c] = val_stay
                X[t][1][c] = 0
            else:
                V[t][1][c] = val_turn_off
                X[t][1][c] = -1

    return V, X


def extract_schedule_ext2(X, demands, step=50):
    """Simule la trajectoire pour l'Extension 2."""
    T = X.shape[0]
    states = np.zeros(T + 1, dtype=int)
    cum = np.zeros(T + 1, dtype=int)
    decisions = np.zeros(T, dtype=int)

    for t in range(T):
        s = states[t]
        c = cum[t]
        x = X[t][s][c]
        decisions[t] = x
        d_step = int(demands[t] / step)

        if s == 0 and x == 1:
            states[t + 1] = 1
            cum[t + 1] = c + d_step
        elif s == 0 and x == 0:
            states[t + 1] = 0
            cum[t + 1] = c
        elif s == 1 and x == 0:
            states[t + 1] = 1
            cum[t + 1] = c + d_step
        elif s == 1 and x == -1:
            states[t + 1] = 0
            cum[t + 1] = c

    return states, decisions, cum


# ============================================================================
# 5. EXTENSION 3 : Demande stochastique le dimanche (+ plafond 16 500 MWh)
# ============================================================================

def solve_ext3_stochastic(margins, demands, startups, stoch_demand,
                          max_mwh=16500):
    """
    Extension 3 : Comme l'Extension 2 (plafond de production), mais la
    demande du dimanche est stochastique.

    Pour les heures du dimanche (t=144..167), la demande D_t est une
    variable aléatoire prenant 2 valeurs avec des probabilités données.
    La demande de chaque heure est indépendante de l'heure précédente.

    L'équation de Bellman devient :
      V_t(s,c) = max_x { E_D[ C(x, s, m_t, D) + V_{t+1}(s', c') ] }

    Pour les heures Lundi-Samedi (t=0..143), c'est identique à l'Ext 2
    (demande déterministe).
    """
    T = len(margins)
    step = 50
    n_cum = max_mwh // step + 1

    V = np.full((T + 1, 2, n_cum), -1e15)
    X = np.zeros((T, 2, n_cum), dtype=int)

    # Condition terminale
    for c in range(n_cum):
        V[T][0][c] = 0.0
        V[T][1][c] = -1e15

    for t in range(T - 1, -1, -1):
        m = margins[t]
        f = startups[t]
        day = t // 24         # 0=Lun, ..., 6=Dim
        hour_in_day = t % 24  # 0-23

        if day == 6:
            # --- DIMANCHE : demande stochastique ---
            D1, p1, D2, p2 = stoch_demand[hour_in_day]
            scenarios = [(D1, p1), (D2, p2)]
        else:
            # --- Lundi à Samedi : demande déterministe ---
            D_det = demands[t]
            scenarios = [(D_det, 1.0)]

        for c in range(n_cum):
            # === État 0 (éteinte) ===
            # Option : rester éteinte (pas de production, pas de dépendance à D)
            ev_off = 0.0 + V[t + 1][0][c]

            # Option : allumer
            ev_on = 0.0
            feasible_on = True
            for D_val, prob in scenarios:
                d_step = int(D_val / step)
                new_c = c + d_step
                if new_c < n_cum:
                    ev_on += prob * (m * D_val - f + V[t + 1][1][new_c])
                else:
                    # Si un scénario dépasse le plafond, on ne peut pas allumer
                    # (car si on est allumée, on DOIT satisfaire la demande)
                    feasible_on = False
                    break

            if not feasible_on:
                ev_on = -1e15

            if ev_on > ev_off:
                V[t][0][c] = ev_on
                X[t][0][c] = 1
            else:
                V[t][0][c] = ev_off
                X[t][0][c] = 0

            # === État 1 (allumée) ===
            ev_stay = 0.0
            feasible_stay = True
            for D_val, prob in scenarios:
                d_step = int(D_val / step)
                new_c = c + d_step
                if new_c < n_cum:
                    ev_stay += prob * (m * D_val + V[t + 1][1][new_c])
                else:
                    feasible_stay = False
                    break

            if not feasible_stay:
                ev_stay = -1e15

            ev_turn_off = 0.0 + V[t + 1][0][c]

            if ev_stay >= ev_turn_off:
                V[t][1][c] = ev_stay
                X[t][1][c] = 0
            else:
                V[t][1][c] = ev_turn_off
                X[t][1][c] = -1

    return V, X


# ============================================================================
# 6. FONCTIONS D'AFFICHAGE ET DE RÉSULTATS
# ============================================================================

def print_weekly_schedule(states, demands, margins, startups, title=""):
    """Affiche le planning on/off de la semaine sous forme de tableau."""
    days = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]

    print(f"\n{'='*80}")
    print(f"  {title}")
    print(f"{'='*80}")

    total_profit = 0.0
    total_mwh = 0.0
    n_startups = 0

    for day_idx in range(7):
        print(f"\n  {days[day_idx]}")
        print(f"  {'Heure':>5} {'État':>6} {'Marge':>8} {'Demande':>8} "
              f"{'Startup':>8} {'Profit_h':>10}")
        print(f"  {'-'*55}")

        for h in range(24):
            t = day_idx * 24 + h
            s = states[t + 1]  # état APRÈS la décision à t

            if states[t] == 0 and s == 1:
                # Allumage
                profit_h = margins[t] * demands[t] - startups[t]
                status = "ON*"
                n_startups += 1
            elif s == 1:
                # Reste allumée
                profit_h = margins[t] * demands[t]
                status = "ON"
            else:
                profit_h = 0.0
                status = "off"

            if s == 1:
                total_mwh += demands[t]

            total_profit += profit_h

            print(f"  {h+1:>5} {status:>6} {margins[t]:>8.2f} {demands[t]:>8.0f} "
                  f"{startups[t]:>8.0f} {profit_h:>10.2f}")

    print(f"\n  {'='*55}")
    print(f"  Profit total optimal : {total_profit:>12.2f} €")
    print(f"  Production totale    : {total_mwh:>12.0f} MWh")
    print(f"  Nombre de démarrages : {n_startups:>12d}")
    print(f"  {'='*55}")
    return total_profit, total_mwh, n_startups


def print_compact_schedule(states, title=""):
    """Affiche un résumé compact du planning (grille 24h x 7 jours)."""
    days = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]

    print(f"\n  {title}")
    print(f"  {'Heure':>5}", end="")
    for d in days:
        print(f" {d:>5}", end="")
    print()
    print(f"  {'-'*47}")

    for h in range(24):
        print(f"  {h+1:>5}", end="")
        for day_idx in range(7):
            t = day_idx * 24 + h
            s = states[t + 1]
            if states[t] == 0 and s == 1:
                print(f"  ON*", end="")   # démarrage
            elif s == 1:
                print(f"   ON", end="")
            else:
                print(f"    .", end="")
        print()


# ============================================================================
# 7. PROGRAMME PRINCIPAL
# ============================================================================

if __name__ == "__main__":

    print("=" * 80)
    print("  PROJET 3 : DISPATCH D'UNE CENTRALE - PROGRAMMATION DYNAMIQUE")
    print("=" * 80)

    # --- Chargement des données ---
    margins, demands, startups, stoch_demand = load_data(
        "/mnt/project/Project3data.xls"
    )
    (margins_24, demands_24, startups_24,
     ref_V_s0, ref_V_s1, ref_x_s0, ref_x_s1) = load_24h_validation(
        "/mnt/project/Project3code_Student.xlsm"
    )

    # ====================================================================
    # ÉTAPE 0 : VALIDATION SUR LE CAS 24H
    # ====================================================================
    print("\n" + "=" * 80)
    print("  ÉTAPE 0 : VALIDATION SUR LE CAS 24 HEURES (données du cours)")
    print("=" * 80)

    V_24, X_24 = solve_base_dp(margins_24, demands_24, startups_24)
    states_24, decisions_24 = extract_schedule(X_24, s0=0)

    print(f"\n  V_1(s=0) calculé  = {V_24[0][0]:.6f} €")
    print(f"  V_1(s=0) référence = {ref_V_s0[0]:.6f} €")
    print(f"  Écart              = {abs(V_24[0][0] - ref_V_s0[0]):.6f} €")

    if abs(V_24[0][0] - ref_V_s0[0]) < 0.01:
        print("  ✓ VALIDATION RÉUSSIE")
    else:
        print("  ✗ ÉCART DÉTECTÉ — vérifier le code")

    # Comparer les décisions
    print(f"\n  Comparaison des décisions (x* pour s=0) :")
    print(f"  {'Heure':>5} {'Calc':>6} {'Réf':>6} {'Match':>6}")
    all_match = True
    for t in range(24):
        calc = X_24[t][0]
        ref = int(ref_x_s0[t])
        match = "✓" if calc == ref else "✗"
        if calc != ref:
            all_match = False
        print(f"  {t+1:>5} {calc:>6} {ref:>6} {match:>6}")

    if all_match:
        print("  ✓ Toutes les décisions correspondent")

    # ====================================================================
    # ÉTAPE 1 : PROBLÈME DE BASE (168 HEURES)
    # ====================================================================
    print("\n" + "=" * 80)
    print("  ÉTAPE 1 : PROBLÈME DE BASE — 168 HEURES")
    print("=" * 80)

    V_base, X_base = solve_base_dp(margins, demands, startups)
    states_base, decisions_base = extract_schedule(X_base, s0=0)

    print(f"\n  Profit optimal V_1(0) = {V_base[0][0]:.2f} €")

    print_compact_schedule(states_base, "Planning ON/OFF optimal (base)")

    profit_base, mwh_base, nstart_base = print_weekly_schedule(
        states_base, demands, margins, startups,
        "RÉSULTATS DU PROBLÈME DE BASE"
    )

    # ====================================================================
    # ÉTAPE 2 : EXTENSION 1 — Durée minimale 10 heures
    # ====================================================================
    print("\n" + "=" * 80)
    print("  EXTENSION 1 : DURÉE MINIMALE DE FONCTIONNEMENT (10h)")
    print("=" * 80)

    V_ext1, X_ext1 = solve_ext1_min_runtime(margins, demands, startups, min_hours=10)
    states_ext1, decisions_ext1 = extract_schedule_ext1(X_ext1, min_hours=10)

    print(f"\n  Profit optimal V_1(0) = {V_ext1[0][0]:.2f} €")
    print(f"  Différence vs base    = {V_ext1[0][0] - V_base[0][0]:.2f} €")

    print_compact_schedule(states_ext1, "Planning ON/OFF optimal (Ext 1 : min 10h)")

    profit_ext1, mwh_ext1, nstart_ext1 = print_weekly_schedule(
        states_ext1, demands, margins, startups,
        "RÉSULTATS EXTENSION 1"
    )

    # ====================================================================
    # ÉTAPE 3 : EXTENSION 2 — Plafond 16 500 MWh
    # ====================================================================
    print("\n" + "=" * 80)
    print("  EXTENSION 2 : PLAFOND DE PRODUCTION 16 500 MWh")
    print("=" * 80)

    V_ext2, X_ext2 = solve_ext2_production_cap(margins, demands, startups, max_mwh=16500)
    states_ext2, decisions_ext2, cum_ext2 = extract_schedule_ext2(
        X_ext2, demands, step=50
    )

    print(f"\n  Profit optimal V_1(0) = {V_ext2[0][0][0]:.2f} €")
    print(f"  Différence vs base    = {V_ext2[0][0][0] - V_base[0][0]:.2f} €")

    print_compact_schedule(states_ext2, "Planning ON/OFF optimal (Ext 2 : cap 16500 MWh)")

    profit_ext2, mwh_ext2, nstart_ext2 = print_weekly_schedule(
        states_ext2, demands, margins, startups,
        "RÉSULTATS EXTENSION 2"
    )

    # ====================================================================
    # ÉTAPE 4 : EXTENSION 3 — Demande stochastique dimanche + plafond
    # ====================================================================
    print("\n" + "=" * 80)
    print("  EXTENSION 3 : DEMANDE STOCHASTIQUE (DIMANCHE) + PLAFOND 16 500 MWh")
    print("=" * 80)

    V_ext3, X_ext3 = solve_ext3_stochastic(
        margins, demands, startups, stoch_demand, max_mwh=16500
    )

    print(f"\n  Profit espéré optimal V_1(0) = {V_ext3[0][0][0]:.2f} €")
    print(f"  Différence vs Ext 2 (dét.)   = {V_ext3[0][0][0] - V_ext2[0][0][0]:.2f} €")

    # Comparer avec le cas déterministe (demande espérée)
    # Pour cela, on résout l'Ext 2 mais avec la demande espérée du dimanche
    demands_expected = demands.copy()
    for h in range(24):
        D1, p1, D2, p2 = stoch_demand[h]
        demands_expected[144 + h] = D1 * p1 + D2 * p2  # E[D]

    V_ext3_det, _ = solve_ext2_production_cap(
        margins, demands_expected, startups, max_mwh=16500
    )

    print(f"  Profit avec E[D] (dét.)      = {V_ext3_det[0][0][0]:.2f} €")
    print(f"  Écart stoch. vs E[D]         = "
          f"{V_ext3[0][0][0] - V_ext3_det[0][0][0]:.2f} €")

    if abs(V_ext3[0][0][0] - V_ext3_det[0][0][0]) > 0.01:
        print("  → La demande espérée ne donne PAS le même résultat que le")
        print("    modèle stochastique. Cela illustre l'inégalité de Jensen :")
        print("    E[V(D)] ≠ V(E[D]) quand il y a une contrainte non-linéaire")
        print("    (ici, le plafond de production).")
    else:
        print("  → Les résultats sont identiques (cas rare).")

    # ====================================================================
    # RÉSUMÉ COMPARATIF
    # ====================================================================
    print("\n" + "=" * 80)
    print("  RÉSUMÉ COMPARATIF")
    print("=" * 80)
    print(f"\n  {'Cas':<35} {'Profit (€)':>12} {'MWh':>8} {'Démarr.':>8}")
    print(f"  {'-'*65}")
    print(f"  {'Base (168h)':<35} {profit_base:>12.2f} {mwh_base:>8.0f} {nstart_base:>8}")
    print(f"  {'Ext 1 : min 10h':<35} {profit_ext1:>12.2f} {mwh_ext1:>8.0f} {nstart_ext1:>8}")
    print(f"  {'Ext 2 : cap 16500 MWh':<35} {profit_ext2:>12.2f} {mwh_ext2:>8.0f} {nstart_ext2:>8}")
    print(f"  {'Ext 3 : stoch. + cap (espéré)':<35} {V_ext3[0][0][0]:>12.2f} {'N/A':>8} {'N/A':>8}")
    print(f"  {'Ext 3 avec E[D] (comparaison)':<35} {V_ext3_det[0][0][0]:>12.2f} {'N/A':>8} {'N/A':>8}")

