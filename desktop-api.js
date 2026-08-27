window.desktopApi = window.__TAURI__?.core?.invoke
  ? {
      solveDraw: (hand) => window.__TAURI__.core.invoke("solve_draw", { hand }),
      solveGame2: (player, dealer) => window.__TAURI__.core.invoke("solve_game2", { player, dealer }),
    }
  : null;
