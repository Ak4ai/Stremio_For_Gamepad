import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { LiquidGlassLayer } from './LiquidGlassLayer';
import type { StremioMetaPreview } from '../types/stremio';
import { StremioService } from '../services/stremio';
import { GamepadManager, type GamepadAction } from '../services/gamepad';
import { SoundService } from '../services/sound';
import { ControllerButtonBadge } from './ControllerButtonBadge';
import { MediaCard } from './MediaCard';
import { LiquidGlassRail } from './LiquidGlassRail';
import { moveKeyboardHorizontal, moveKeyboardVertical, RelativeKeyboardTouchpad, TouchpadActivationGuard, liquidKeyboardPath, keyboardDetachmentProgress, keyboardGelSpring } from '../utils/keyboardNavigation';
import { mergedKeyboardGel } from '../utils/keyboardGel';
import { subscribeDualSenseTouchpad, requestDualSenseTouchpadPermission, isTouchpadSupported, type TouchpadEvent } from '../services/dualsenseTouchpad';
import {
  Search,
  X,
  Film,
  Tv,
  LayoutGrid,
  Sparkles,
  ArrowRight,
} from 'lucide-react';

interface Props {
  onClose: () => void;
  onSelectItem: (item: StremioMetaPreview) => void;
  allCatalogItems: StremioMetaPreview[];
}

interface KeyDef {
  id: string;
  label: string;
  display?: string;
  action?: 'insert' | 'space' | 'backspace' | 'clear' | 'results';
  colSpan?: number; // Visual column span in CSS grid
}

const KEYBOARD_ROWS: KeyDef[][] = [
  // Row 0: Numbers
  [
    { id: '1', label: '1' },
    { id: '2', label: '2' },
    { id: '3', label: '3' },
    { id: '4', label: '4' },
    { id: '5', label: '5' },
    { id: '6', label: '6' },
    { id: '7', label: '7' },
    { id: '8', label: '8' },
    { id: '9', label: '9' },
    { id: '0', label: '0' },
  ],
  // Row 1: Q - P
  [
    { id: 'Q', label: 'Q' },
    { id: 'W', label: 'W' },
    { id: 'E', label: 'E' },
    { id: 'R', label: 'R' },
    { id: 'T', label: 'T' },
    { id: 'Y', label: 'Y' },
    { id: 'U', label: 'U' },
    { id: 'I', label: 'I' },
    { id: 'O', label: 'O' },
    { id: 'P', label: 'P' },
  ],
  // Row 2: A - Ç
  [
    { id: 'A', label: 'A' },
    { id: 'S', label: 'S' },
    { id: 'D', label: 'D' },
    { id: 'F', label: 'F' },
    { id: 'G', label: 'G' },
    { id: 'H', label: 'H' },
    { id: 'J', label: 'J' },
    { id: 'K', label: 'K' },
    { id: 'L', label: 'L' },
    { id: 'Ç', label: 'Ç' },
  ],
  // Row 3: Z - :
  [
    { id: 'Z', label: 'Z' },
    { id: 'X', label: 'X' },
    { id: 'C', label: 'C' },
    { id: 'V', label: 'V' },
    { id: 'B', label: 'B' },
    { id: 'N', label: 'N' },
    { id: 'M', label: 'M' },
    { id: '.', label: '.' },
    { id: '-', label: '-' },
    { id: ':', label: ':' },
  ],
  // Row 4: Action Bar
  [
    { id: 'space', label: 'Espaço', display: '␣ Espaço', action: 'space', colSpan: 4 },
    { id: 'backspace', label: 'Apagar', display: '⌫ Apagar', action: 'backspace', colSpan: 2 },
    { id: 'clear', label: 'Limpar', display: 'Limpar', action: 'clear', colSpan: 2 },
    { id: 'results', label: 'Resultados', display: 'Resultados →', action: 'results', colSpan: 2 },
  ],
];

type FilterType = 'all' | 'movie' | 'series';
type FocusZone = 'keyboard' | 'results';

// A neutral center and directional edge channels produce a restrained glass lens.
const GLASS_DISPLACEMENT = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><defs><linearGradient id="r"><stop stop-color="rgb(0,0,128)"/><stop offset=".5" stop-color="rgb(128,0,128)"/><stop offset="1" stop-color="rgb(255,0,128)"/></linearGradient><linearGradient id="g" x2="0" y2="1"><stop stop-color="rgb(0,0,0)"/><stop offset=".5" stop-color="rgb(0,128,0)"/><stop offset="1" stop-color="rgb(0,255,0)"/></linearGradient><filter id="soft"><feGaussianBlur stdDeviation="4"/></filter></defs><rect width="128" height="128" fill="url(#r)"/><rect width="128" height="128" fill="url(#g)" style="mix-blend-mode:screen"/><rect x="10" y="10" width="108" height="108" rx="20" fill="rgb(128,128,128)" filter="url(#soft)"/></svg>`)}`;

function paintKeyboardGlass(selector: HTMLDivElement, width: number, height: number, progress: number, horizontal: boolean, phase = 0, mergedShape?: string) {
  const shape = mergedShape || liquidKeyboardPath(width, height, progress, horizontal, phase);
  selector.querySelector?.('svg')?.setAttribute('viewBox', `0 0 ${width} ${height}`);
  selector.querySelector?.('path')?.setAttribute('d', shape);
  selector.querySelector?.<HTMLDivElement>('.keyboard-glass-lens')?.style.setProperty('clip-path', `path("${shape}")`);
}

export const SearchModal: React.FC<Props> = ({ onClose, onSelectItem, allCatalogItems }) => {
  const [query, setQuery] = useState('');
  const [inputType, setInputType] = useState(GamepadManager.activeControllerType);
  useEffect(() => GamepadManager.subscribeControllerType((type) => setInputType(type)), []);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [focusZone, setFocusZone] = useState<FocusZone>('keyboard');

  // Keyboard navigation coordinates
  const [keyRow, setKeyRow] = useState(1); // Default focused on 'Q' or middle row
  const [keyCol, setKeyCol] = useState(0);

  // Results navigation index
  const [resultsIndex, setResultsIndex] = useState(0);
  const [results, setResults] = useState<StremioMetaPreview[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const touchpadCleanupRef = useRef<(() => void) | null>(null);
  const relativeTouchpadRef = useRef(new RelativeKeyboardTouchpad());
  const touchpadGuardRef = useRef(new TouchpadActivationGuard());
  const touchpadSuppressTapUntilRef = useRef(0);
  const keyboardGridRef = useRef<HTMLDivElement>(null);
  const keyboardSelectorRef = useRef<HTMLDivElement>(null);
  const keyboardKeysRef = useRef(new Map<string, HTMLButtonElement>());
  const selectorAnimationRef = useRef<Animation | null>(null);
  const animateSelectorRef = useRef(false);
  const visualTouchKeyRef = useRef<{ row: number; col: number } | null>(null);
  const touchpadRecoveryRef = useRef<number | null>(null);
  const touchpadDraggingRef = useRef(false);
  const stopTouchpadRecovery = useCallback(() => {
    if (touchpadRecoveryRef.current !== null) cancelAnimationFrame(touchpadRecoveryRef.current);
    touchpadRecoveryRef.current = null;
    touchpadDraggingRef.current = false;
  }, []);

  const verticalKeyboardPosition = useCallback((row: number, col: number, direction: -1 | 1) =>
    moveKeyboardVertical(KEYBOARD_ROWS, row, col, direction, (r, c) =>
      keyboardKeysRef.current.get(KEYBOARD_ROWS[r][c].id)?.getBoundingClientRect()), []);

  useEffect(() => {
    const grid = keyboardGridRef.current;
    const selector = keyboardSelectorRef.current;
    const key = keyboardKeysRef.current.get(KEYBOARD_ROWS[keyRow][keyCol].id);
    if (!grid || !selector || !key) return;
    const position = (animate = false) => {
      const origin = grid.getBoundingClientRect();
      const target = key.getBoundingClientRect();
      const current = selector.getBoundingClientRect();
      const wasVisible = selector.style.visibility === 'visible';
      selectorAnimationRef.current?.cancel();
      selector.style.transform = '';
      visualTouchKeyRef.current = null;
      const next = { left: target.left - origin.left - 4, top: target.top - origin.top - 4, width: target.width + 8, height: target.height + 8 };
      Object.assign(selector.style, { left: `${next.left}px`, top: `${next.top}px`, width: `${next.width}px`, height: `${next.height}px`, visibility: focusZone === 'keyboard' ? 'visible' : 'hidden' });
      paintKeyboardGlass(selector, next.width, next.height, 0, true);
      if (!animate || !wasVisible || focusZone !== 'keyboard' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      const previous = { left: current.left - origin.left, top: current.top - origin.top, width: current.width, height: current.height };
      const deformation = relativeTouchpadRef.current.getMotionStyle().deformation;
      const frames = Array.from({ length: 19 }, (_, i) => {
        const t = i / 18;
        const easeOut = 1 - Math.pow(1 - t, 3);
        const spring = i === 18 ? 1 : easeOut + (keyboardGelSpring(t * 0.26) - easeOut) * deformation;
        return {
          left: `${previous.left + (next.left - previous.left) * spring}px`,
          top: `${previous.top + (next.top - previous.top) * spring}px`,
          width: `${previous.width + (next.width - previous.width) * spring}px`,
          height: `${previous.height + (next.height - previous.height) * spring}px`,
          offset: t,
        };
      });
      selectorAnimationRef.current = selector.animate(frames, { duration: 100 + 160 * deformation, easing: 'linear' });
    };
    position(animateSelectorRef.current);
    animateSelectorRef.current = false;
    let observedWidth = grid.clientWidth;
    let observedHeight = grid.clientHeight;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
      // The initial observer notification must not cancel the snap animation.
      if (grid.clientWidth === observedWidth && grid.clientHeight === observedHeight) return;
      observedWidth = grid.clientWidth; observedHeight = grid.clientHeight;
      position();
    });
    observer?.observe(grid);
    return () => observer?.disconnect();
  }, [keyRow, keyCol, focusZone]);

  useEffect(() => () => { selectorAnimationRef.current?.cancel(); stopTouchpadRecovery(); }, [stopTouchpadRecovery]);
  useEffect(() => { if (focusZone !== 'keyboard') stopTouchpadRecovery(); }, [focusZone, stopTouchpadRecovery]);

  const pullKeyboardSelector = useCallback((active: boolean) => {
    const selector = keyboardSelectorRef.current;
    const grid = keyboardGridRef.current;
    if (!selector || !grid) return;
    const state = stateRef.current;
    if (state.focusZone !== 'keyboard') return;
    const key = keyboardKeysRef.current.get(KEYBOARD_ROWS[state.keyRow][state.keyCol].id);
    if (!key) return;
    const { x, y } = relativeTouchpadRef.current.getDragProgress();
    const progress = Math.max(Math.abs(x), Math.abs(y));
    // Finger movement owns the geometry, even while a previous snap is settling.
    const origin = grid.getBoundingClientRect();
    const anchor = key.getBoundingClientRect();
    const current = selector.getBoundingClientRect();
    selectorAnimationRef.current?.cancel();
    selector.style.transform = '';
    let row = state.keyRow;
    let col = state.keyCol;
    if (y) {
      const next = verticalKeyboardPosition(row, col, y > 0 ? 1 : -1);
      row = next.row; col = next.col;
    }
    if (x) {
      const next = moveKeyboardHorizontal(KEYBOARD_ROWS, row, col, x > 0 ? 1 : -1, false);
      row = next.row; col = next.col;
    }
    const neighbor = keyboardKeysRef.current.get(KEYBOARD_ROWS[row][col].id)?.getBoundingClientRect() || anchor;
    const drag = active ? keyboardDetachmentProgress(progress) : 0;
    visualTouchKeyRef.current = active && drag >= 0.5 ? { row, col } : { row: state.keyRow, col: state.keyCol };
    const source = { left: anchor.left - origin.left - 4, top: anchor.top - origin.top - 4, width: anchor.width + 8, height: anchor.height + 8 };
    const destination = { left: neighbor.left - origin.left - 4, top: neighbor.top - origin.top - 4, width: neighbor.width + 8, height: neighbor.height + 8 };
    const gel = mergedKeyboardGel(source, destination, drag, 0.85, relativeTouchpadRef.current.getMotionStyle().deformation);
    const next = { left: `${gel.left}px`, top: `${gel.top}px`, width: `${gel.width}px`, height: `${gel.height}px` };
    Object.assign(selector.style, next);
    paintKeyboardGlass(selector, gel.width, gel.height, drag, x !== 0, 0, gel.path);
    if (!active && selector.style.visibility === 'visible' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      selectorAnimationRef.current = selector.animate([
        { left: `${current.left - origin.left}px`, top: `${current.top - origin.top}px`, width: `${current.width}px`, height: `${current.height}px` },
        next,
      ], { duration: 130, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)' });
    }
  }, [verticalKeyboardPosition]);

  const recoverTouchpadShape = useCallback(() => {
    if (touchpadRecoveryRef.current !== null || typeof requestAnimationFrame === 'undefined') return;
    let previous = relativeTouchpadRef.current.getMotionStyle().deformation;
    const frame = () => {
      touchpadRecoveryRef.current = null;
      if (!touchpadDraggingRef.current || stateRef.current.focusZone !== 'keyboard') return;
      const deformation = relativeTouchpadRef.current.getMotionStyle().deformation;
      const drag = relativeTouchpadRef.current.getDragProgress();
      // Recover the contour without moving focus or interrupting a completed snap.
      if ((drag.x || drag.y) && Math.abs(deformation - previous) >= 0.005) {
        pullKeyboardSelector(true);
        previous = deformation;
      }
      if (deformation < 1) touchpadRecoveryRef.current = requestAnimationFrame(frame);
    };
    if (previous < 1) touchpadRecoveryRef.current = requestAnimationFrame(frame);
  }, [pullKeyboardSelector]);

  // Refs for scrolling and stable state
  const resultsContainerRef = useRef<HTMLDivElement>(null);
  const resultCardsRef = useRef<(HTMLDivElement | null)[]>([]);
  const queryInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable state ref for gamepad listener
  const stateRef = useRef({
    query,
    filterType,
    focusZone,
    keyRow,
    keyCol,
    resultsIndex,
    results,
    onClose,
    onSelectItem,
  });

  stateRef.current = {
    query,
    filterType,
    focusZone,
    keyRow,
    keyCol,
    resultsIndex,
    results,
    onClose,
    onSelectItem,
  };

  // Initial suggestions when query is empty
  const defaultSuggestions = useMemo(() => {
    let list = allCatalogItems;
    if (filterType === 'movie') {
      list = list.filter((i) => i.type === 'movie');
    } else if (filterType === 'series') {
      list = list.filter((i) => i.type === 'series');
    }
    return list.slice(0, 18);
  }, [allCatalogItems, filterType]);

  const displayedItems = useMemo(() => {
    return query.trim() ? results : defaultSuggestions;
  }, [query, results, defaultSuggestions]);

  // Execute catalog search whenever query or filter changes (debounced)
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(async () => {
      try {
        const fetched = await StremioService.searchCatalog(trimmed, filterType);
        setResults(fetched);
      } catch (err) {
        console.warn('Erro ao pesquisar:', err);
      } finally {
        setIsSearching(false);
      }
    }, 280);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [query, filterType]);

  // Auto-scroll focused result card into view
  useEffect(() => {
    if (focusZone === 'results') {
      const card = resultCardsRef.current[resultsIndex];
      if (card) {
        card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }, [resultsIndex, focusZone]);

  // Handle typing key action
  const handleKeyAction = useCallback((key: KeyDef) => {
    GamepadManager.pulseHaptic(45, 0.55, 0.3);

    if (key.action === 'space') {
      SoundService.playKeyboardNav();
      setQuery((prev) => (prev ? prev + ' ' : ''));
    } else if (key.action === 'backspace') {
      SoundService.playBack();
      setQuery((prev) => prev.slice(0, -1));
    } else if (key.action === 'clear') {
      SoundService.playBack();
      setQuery('');
      setResultsIndex(0);
    } else if (key.action === 'results') {
      stateRef.current.focusZone = 'results';
      SoundService.playTabSwitch();
      setFocusZone('results');
      setResultsIndex(0);
    } else {
      SoundService.playKeyboardNav();
      setQuery((prev) => prev + key.label);
    }
  }, []);

  const moveKeyFocus = useCallback((row: number, col: number) => {
    stateRef.current.keyRow = row;
    stateRef.current.keyCol = col;
    setKeyRow(row); setKeyCol(col);
  }, []);

  const activateTouchpadKey = useCallback(() => {
    const state = stateRef.current;
    if (state.focusZone !== 'keyboard') return;
    const visual = visualTouchKeyRef.current || { row: state.keyRow, col: state.keyCol };
    const key = KEYBOARD_ROWS[visual.row][visual.col];
    if (!touchpadGuardRef.current.allow(key.id, performance.now())) return;
    if (visual.row !== state.keyRow || visual.col !== state.keyCol) moveKeyFocus(visual.row, visual.col);
    visualTouchKeyRef.current = null;
    stopTouchpadRecovery();
    relativeTouchpadRef.current.reset();
    handleKeyAction(key);
  }, [handleKeyAction, moveKeyFocus, stopTouchpadRecovery]);

  const onTouchpad = useCallback((event: TouchpadEvent) => {
    const state = stateRef.current;
    if (state.focusZone !== 'keyboard') { stopTouchpadRecovery(); relativeTouchpadRef.current.reset(); return; }
    if (!event.active) stopTouchpadRecovery();
    touchpadDraggingRef.current = event.active;
    const directions = relativeTouchpadRef.current.update(event);
    if (!directions.length) pullKeyboardSelector(event.active);
    if (directions.length || event.activate) GamepadManager.markGamepadActive('playstation');
    let row = state.keyRow;
    let col = state.keyCol;
    for (const direction of directions) {
      if (direction === 'left' || direction === 'right') {
        const next = moveKeyboardHorizontal(KEYBOARD_ROWS, row, col, direction === 'right' ? 1 : -1, false);
        row = next.row; col = next.col;
      } else {
        const next = verticalKeyboardPosition(row, col, direction === 'down' ? 1 : -1);
        row = next.row; col = next.col;
      }
    }
    if (row !== state.keyRow || col !== state.keyCol) {
        animateSelectorRef.current = true;
        moveKeyFocus(row, col);
        GamepadManager.pulseHaptic(28, 0.45, 0.18);
        SoundService.playKeyboardNav();
    }
    if (event.active) recoverTouchpadShape();
    if (event.activate && performance.now() >= touchpadSuppressTapUntilRef.current) activateTouchpadKey();
  }, [moveKeyFocus, activateTouchpadKey, pullKeyboardSelector, verticalKeyboardPosition, recoverTouchpadShape, stopTouchpadRecovery]);

  useEffect(() => {
    if (!isTouchpadSupported()) return;
    let permissionRequested = false;
    const cleanup = subscribeDualSenseTouchpad(onTouchpad);
    touchpadCleanupRef.current = cleanup;
    const requestPermission = () => {
      const pad = GamepadManager.getActiveGamepad();
      if (!permissionRequested && pad && /dualsense|0ce6|0df2/i.test(pad.id) && navigator.userActivation?.isActive) {
        permissionRequested = true;
        requestDualSenseTouchpadPermission();
      }
    };
    const onInteraction = (event: Event) => { if (event.isTrusted) requestPermission(); };
    requestPermission();
    window.addEventListener('pointerdown', onInteraction, true);
    window.addEventListener('keydown', onInteraction, true);
    return () => {
      window.removeEventListener('pointerdown', onInteraction, true);
      window.removeEventListener('keydown', onInteraction, true);
      cleanup();
      touchpadCleanupRef.current = null;
    };
  }, [onTouchpad]);

  // Quick helper: Cycle Category Filter
  const cycleFilter = useCallback((direction: 'next' | 'prev') => {
    SoundService.playTabSwitch();
    GamepadManager.pulseHaptic(25, 0.25, 0.25);
    const filters: FilterType[] = ['all', 'movie', 'series'];
    setFilterType((prev) => {
      const curIdx = filters.indexOf(prev);
      const nextIdx =
        direction === 'next'
          ? (curIdx + 1) % filters.length
          : (curIdx - 1 + filters.length) % filters.length;
      return filters[nextIdx];
    });
    setResultsIndex(0);
  }, []);

  // Capture text before the shared navigation listener can interpret letters as shortcuts.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.isTrusted !== false) GamepadManager.markKeyboardActive();
      const target = e.target as HTMLElement;
      if (e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
      const editingQuery = target === queryInputRef.current;
      if (!editingQuery && target?.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (target?.closest?.('button, a[href]') && (e.key === 'Enter' || e.key === ' ')) return;
      // Once virtual navigation resumes, Enter should target that selection rather than a stale DOM button.
      if (target?.closest?.('button') && (e.key.startsWith('Arrow') || e.key.length === 1)) target.blur();
      const consume = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.key === 'PageUp' || e.key === 'PageDown') {
        consume();
        cycleFilter(e.key === 'PageUp' ? 'prev' : 'next');
        return;
      }
      if (editingQuery && !['Enter', 'Tab', 'Escape'].includes(e.key)) return;
      if (e.key === 'Backspace') {
        consume();
        setQuery((prev) => prev.slice(0, -1));
        setFocusZone('keyboard');
      } else if (e.key === 'Delete') {
        consume();
        setQuery('');
        setFocusZone('keyboard');
      } else if (e.key === 'Tab') {
        consume();
        if (stateRef.current.focusZone === 'results') setFocusZone('keyboard');
        else if (displayedItems.length) { setFocusZone('results'); setResultsIndex(0); queryInputRef.current?.blur(); }
      } else if (e.key === 'Enter') {
        consume();
        if (e.repeat) return;
        if (stateRef.current.focusZone === 'keyboard' && displayedItems.length > 0) {
          setFocusZone('results');
          setResultsIndex(0);
          queryInputRef.current?.blur();
        } else if (stateRef.current.focusZone === 'results') {
          const item = displayedItems[stateRef.current.resultsIndex];
          if (item) onSelectItem(item);
        }
      } else if (e.key.length === 1) {
        consume();
        setQuery((prev) => prev + e.key.toUpperCase());
        setFocusZone('keyboard');
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [displayedItems, onSelectItem, cycleFilter]);

  // Main Gamepad Navigation Engine
  useEffect(() => {
    const handleGamepadAction = (action: GamepadAction) => {
      const {
        focusZone: curZone,
        keyRow: curR,
        keyCol: curC,
        resultsIndex: curResIdx,
      } = stateRef.current;

      const items = displayedItems;
      const RESULTS_COLS = 3; // 3 columns on search results grid

      if (action === 'TOUCHPAD_CLICK') {
        activateTouchpadKey();
        return;
      }

      // Other controls take priority and discard residual finger movement.
      relativeTouchpadRef.current.reset();
      pullKeyboardSelector(false);
      stopTouchpadRecovery();
      touchpadSuppressTapUntilRef.current = performance.now() + 200;

      // Global Filters toggle via Bumpers (LB / RB)
      if (action === 'TRIGGER_LB') {
        cycleFilter('prev');
        return;
      }
      if (action === 'TRIGGER_RB') {
        cycleFilter('next');
        return;
      }

      // Fast Direct Action Shortcuts
      if (action === 'ACTION_X') {
        // Instant Backspace
        GamepadManager.pulseHaptic(20, 0.2, 0.2);
        setQuery((prev) => prev.slice(0, -1));
        return;
      }

      if (action === 'ACTION_Y') {
        // Instant Spacebar
        GamepadManager.pulseHaptic(20, 0.2, 0.2);
        setQuery((prev) => (prev ? prev + ' ' : ''));
        return;
      }

      if (action === 'BUTTON_MENU' || action === 'TRIGGER_RT') {
        // Quick Jump to Results
        if (items.length > 0) {
          GamepadManager.pulseHaptic(30, 0.3, 0.3);
          setFocusZone('results');
          setResultsIndex(0);
        }
        return;
      }

      if (action === 'ACTION_B') {
        stateRef.current.focusZone = curZone === 'results' ? 'keyboard' : curZone;
        // Back Button Logic
        if (curZone === 'results') {
          // Return focus to keyboard
          setFocusZone('keyboard');
          GamepadManager.pulseHaptic(20, 0.2, 0.2);
        } else {
          // Close modal
          onClose();
        }
        return;
      }

      // -------------------------------------------------------------
      // ZONE 1: KEYBOARD NAVIGATION
      // -------------------------------------------------------------
      if (curZone === 'keyboard') {
        const currentRowKeys = KEYBOARD_ROWS[curR];

        switch (action) {
          case 'NAV_UP': {
            if (curR > 0) {
              const next = verticalKeyboardPosition(curR, curC, -1);
              moveKeyFocus(next.row, next.col);
              SoundService.playKeyboardNav();
              GamepadManager.pulseHaptic(15, 0.15, 0.15);
            }
            break;
          }

          case 'NAV_DOWN': {
            if (curR < KEYBOARD_ROWS.length - 1) {
              const next = verticalKeyboardPosition(curR, curC, 1);
              moveKeyFocus(next.row, next.col);
              SoundService.playKeyboardNav();
              GamepadManager.pulseHaptic(15, 0.15, 0.15);
            } else if (items.length > 0) {
              // Pressing down from bottom action bar jumps to results
              SoundService.playTabSwitch();
              setFocusZone('results');
              setResultsIndex(0);
              GamepadManager.pulseHaptic(25, 0.25, 0.25);
            }
            break;
          }

          case 'NAV_LEFT':
          case 'NAV_RIGHT': {
            const next = moveKeyboardHorizontal(KEYBOARD_ROWS, curR, curC, action === 'NAV_RIGHT' ? 1 : -1);
            moveKeyFocus(next.row, next.col);
            SoundService.playKeyboardNav();
            GamepadManager.pulseHaptic(15, 0.15, 0.15);
            break;
          }

          case 'ACTION_A': {
            const visual = visualTouchKeyRef.current;
            if (visual && (visual.row !== curR || visual.col !== curC)) {
              activateTouchpadKey();
              break;
            }
            const focusedKey = currentRowKeys[curC];
            if (focusedKey) {
              handleKeyAction(focusedKey);
            }
            break;
          }
        }
        return;
      }

      // -------------------------------------------------------------
      // ZONE 2: RESULTS GRID NAVIGATION
      // -------------------------------------------------------------
      if (curZone === 'results') {
        const total = items.length;
        if (total === 0) {
          setFocusZone('keyboard');
          return;
        }

        switch (action) {
          case 'NAV_UP': {
            if (curResIdx >= RESULTS_COLS) {
              setResultsIndex(curResIdx - RESULTS_COLS);
              GamepadManager.pulseHaptic(15, 0.15, 0.15);
            } else {
              // On top row of results: jump back to keyboard
              setFocusZone('keyboard');
              setKeyRow(KEYBOARD_ROWS.length - 1);
              setKeyCol(0);
              GamepadManager.pulseHaptic(20, 0.2, 0.2);
            }
            break;
          }

          case 'NAV_DOWN': {
            if (curResIdx + RESULTS_COLS < total) {
              setResultsIndex(curResIdx + RESULTS_COLS);
              GamepadManager.pulseHaptic(15, 0.15, 0.15);
            } else if (curResIdx < total - 1) {
              setResultsIndex(total - 1);
              GamepadManager.pulseHaptic(15, 0.15, 0.15);
            }
            break;
          }

          case 'NAV_LEFT': {
            if (curResIdx % RESULTS_COLS === 0) {
              // Leftmost column: jump back to keyboard
              setFocusZone('keyboard');
              setKeyCol(KEYBOARD_ROWS[keyRow].length - 1);
              GamepadManager.pulseHaptic(20, 0.2, 0.2);
            } else {
              setResultsIndex(curResIdx - 1);
              GamepadManager.pulseHaptic(15, 0.15, 0.15);
            }
            break;
          }

          case 'NAV_RIGHT': {
            if (curResIdx < total - 1 && (curResIdx + 1) % RESULTS_COLS !== 0) {
              setResultsIndex(curResIdx + 1);
              GamepadManager.pulseHaptic(15, 0.15, 0.15);
            }
            break;
          }

          case 'ACTION_A': {
            const item = items[curResIdx];
            if (item) {
              GamepadManager.pulseHaptic(35, 0.35, 0.35);
              onSelectItem(item);
            }
            break;
          }
        }
      }
    };

    const unsubscribe = GamepadManager.subscribe(handleGamepadAction);
    return () => unsubscribe();
  }, [displayedItems, handleKeyAction, activateTouchpadKey, moveKeyFocus, cycleFilter, onClose, onSelectItem, pullKeyboardSelector, verticalKeyboardPosition, stopTouchpadRecovery]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col app-modal-bg bg-[var(--app-bg)]/95 backdrop-blur-2xl select-none animate-fade-in overflow-hidden">
      {/* ========================================================= */}
      {/* 1. TOP HEADER & SEARCH INPUT HUD                          */}
      {/* ========================================================= */}
      <header className="px-10 py-5 app-header-bar flex items-center justify-between gap-6 flex-shrink-0 backdrop-blur-md">
        {/* Brand & Search Title */}
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shadow-lg"
            style={{
              backgroundColor: 'var(--app-accent)',
              boxShadow: '0 0 20px var(--app-accent-glow)',
            }}
          >
            <Search className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-base font-black text-white tracking-wider uppercase">
              Buscar Títulos
            </h1>
            <p className="text-[11px] text-zinc-400">
              Cinemeta, Torrentio e Addons Instalados
            </p>
          </div>
        </div>

        {/* Big Search Input Field with Blinking Cursor */}
        <div className="flex-1 max-w-2xl">
          <div className="relative flex items-center app-input-box rounded-2xl px-5 py-3 shadow-inner transition-colors">
            <Search className="w-5 h-5 text-zinc-400 mr-3 flex-shrink-0" />
            <input
              ref={queryInputRef}
              type="search"
              aria-label="Buscar filmes e séries"
              value={query}
              onChange={(event) => { setQuery(event.target.value); setFocusZone('keyboard'); }}
              onFocus={() => setFocusZone('keyboard')}
              placeholder="Digite com o controle ou teclado físico..."
              className="min-w-0 flex-1 bg-transparent text-lg lg:text-xl font-bold text-white tracking-wide outline-none placeholder:text-zinc-400 placeholder:font-normal"
            />

            {query ? (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 cursor-pointer ml-2"
                title="Limpar pesquisa"
              >
                <X className="w-4 h-4" />
              </button>
            ) : null}

            {isSearching && (
              <div className="ml-3 flex items-center gap-1.5 text-xs font-bold text-[var(--app-accent)]">
                <Sparkles className="w-4 h-4 animate-spin text-[var(--app-accent)]" />
                <span>Buscando...</span>
              </div>
            )}
          </div>
        </div>

        {/* Close Button Hint */}
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => focusZone === 'results' ? setFocusZone('keyboard') : onClose()}>
          <ControllerButtonBadge button="B" label={focusZone === 'results' ? 'Voltar ao teclado' : 'Fechar'} size="sm" />
        </div>
      </header>

      {/* ========================================================= */}
      {/* 2. SPLIT-VIEW MAIN WORKSPACE                              */}
      {/* ========================================================= */}
      <main className="flex-1 flex overflow-hidden px-10 py-6 gap-8">
        {/* LEFT COLUMN: VIRTUAL KEYBOARD & QUICK CONTROLS (44% width) */}
        <section className="w-full md:w-[44%] lg:w-[42%] flex flex-col h-full gap-3.5 p-1 overflow-visible">
          {/* Filter Tabs (LB / RB) */}
          <div className="flex-shrink-0 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center app-card-panel p-2 rounded-2xl">
            <div className="flex items-center gap-1 pl-1 justify-self-start">
              <ControllerButtonBadge button="LB" keyboardLabel="PgUp" size="sm" />
              <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider ml-1">
                Filtrar:
              </span>
            </div>

            <div className="liquid-glass-rail relative isolate flex items-center gap-1.5">
              <LiquidGlassRail selected={filterType} />
              {(
                [
                  { id: 'all', label: 'Todos', icon: LayoutGrid },
                  { id: 'movie', label: 'Filmes', icon: Film },
                  { id: 'series', label: 'Séries', icon: Tv },
                ] as const
              ).map((tab) => {
                const isActive = filterType === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    data-glass-tab={tab.id}
                    data-glass-active={isActive}
                    onClick={() => {
                      setFilterType(tab.id);
                      setResultsIndex(0);
                    }}
                    style={
                      isActive
                        ? {
                            backgroundColor: 'var(--app-accent)',
                            boxShadow: '0 2px 10px var(--app-accent-glow)',
                          }
                        : undefined
                    }
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      isActive
                        ? 'text-white'
                        : 'text-zinc-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="pr-1 justify-self-end">
              <ControllerButtonBadge button="RB" keyboardLabel="PgDn" size="sm" />
            </div>
          </div>

          {/* Virtual Keyboard Grid - Expands vertically to fill available height */}
          <div
            className={`flex-1 flex flex-col p-4 sm:p-5 rounded-3xl transition-all duration-200 app-card-panel min-h-0 overflow-visible ${
              focusZone === 'keyboard'
                ? 'ring-2 ring-white/40 shadow-2xl'
                : 'opacity-85'
            }`}
          >
            {/* Rows Container */}
            <div ref={keyboardGridRef} className="keyboard-with-selector relative flex-1 flex flex-col justify-between gap-2.5 sm:gap-3 p-1">
              <div ref={keyboardSelectorRef} aria-hidden="true" className="keyboard-gliding-selector">
                <div className="keyboard-glass-lens" />
                <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <defs>
                    <filter id="keyboard-glass-refraction" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
                      <feImage href={GLASS_DISPLACEMENT} width="100%" height="100%" preserveAspectRatio="none" result="lens-map" />
                      <feDisplacementMap in="SourceGraphic" in2="lens-map" scale="-9" xChannelSelector="R" yChannelSelector="G" />
                      <feGaussianBlur stdDeviation="0.15" />
                    </filter>
                    <linearGradient id="keyboard-glass-fill" x1="0" y1="0" x2="0.4" y2="1">
                      <stop offset="0" stopColor="white" stopOpacity="0.2" />
                      <stop offset="0.45" stopColor="var(--app-accent)" stopOpacity="0.06" />
                      <stop offset="1" stopColor="white" stopOpacity="0.1" />
                    </linearGradient>
                    <linearGradient id="keyboard-glass-edge" x1="0" y1="0" x2="0.6" y2="1">
                      <stop offset="0" stopColor="white" stopOpacity="0.95" />
                      <stop offset="0.5" stopColor="white" stopOpacity="0.35" />
                      <stop offset="1" stopColor="var(--app-focus-border, white)" stopOpacity="0.8" />
                    </linearGradient>
                  </defs>
                  <path d={liquidKeyboardPath(100, 100, 0, true)} fill="url(#keyboard-glass-fill)" stroke="url(#keyboard-glass-edge)" strokeWidth="1.8" vectorEffect="non-scaling-stroke" />
                </svg>
              </div>
              {KEYBOARD_ROWS.map((row, rIdx) => {
                return (
                  <div key={rIdx} className="flex-1 flex gap-2 sm:gap-2.5 min-h-[44px]">
                    {row.map((key, cIdx) => {
                      const isFocused =
                        focusZone === 'keyboard' && keyRow === rIdx && keyCol === cIdx;
                      const colSpan = key.colSpan || 1;

                      return (
                        <button
                          key={key.id}
                          ref={(element) => { if (element) keyboardKeysRef.current.set(key.id, element); else keyboardKeysRef.current.delete(key.id); }}
                          type="button"
                          onClick={() => {
                            setKeyRow(rIdx);
                            setKeyCol(cIdx);
                            setFocusZone('keyboard');
                            handleKeyAction(key);
                          }}
                          aria-current={isFocused ? 'true' : undefined}
                          style={{ flex: colSpan }}
                          className={`h-full rounded-xl text-base sm:text-lg font-black transition-all flex items-center justify-center cursor-pointer select-none border app-keyboard-key ${
                            isFocused
                              ? 'text-white z-20'
                              : 'shadow-sm'
                          } ${key.action ? 'text-xs sm:text-sm uppercase tracking-wider' : ''}`}
                        >
                          {key.display || key.label}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: SEARCH RESULTS GRID (58% width) */}
        <section
          ref={resultsContainerRef}
          className={`w-full md:w-[58%] flex flex-col overflow-y-auto no-scrollbar rounded-3xl p-5 transition-all duration-200 app-card-panel ${
            focusZone === 'results'
              ? 'ring-2 ring-white/40 shadow-2xl'
              : 'opacity-85'
          }`}
        >
          {/* Results Header */}
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-2.5">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  focusZone === 'results' ? '' : 'bg-zinc-600'
                }`}
                style={focusZone === 'results' ? {
                  background: 'var(--app-accent)',
                  boxShadow: '0 0 10px color-mix(in srgb, var(--app-accent) 80%, transparent)',
                } : undefined}
              />
              <h2 className="text-sm font-black uppercase tracking-wider text-white">
                {query.trim()
                  ? `Resultados para "${query}" (${displayedItems.length})`
                  : `Sugestões em Alta (${displayedItems.length})`}
              </h2>
            </div>

            {focusZone === 'results' ? (
              <span className="text-xs font-bold flex items-center gap-1.5 animate-pulse" style={{ color: 'var(--app-accent)' }}>
                <span>Controle Ativo na Grade</span>
                <ControllerButtonBadge button="A" label="Selecionar" size="sm" />
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (displayedItems.length > 0) {
                    setFocusZone('results');
                    setResultsIndex(0);
                  }
                }}
                className="text-xs font-bold text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer"
              >
                <span>Navegar Resultados</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Results Body */}
          <div className="flex-1">
            {isSearching ? (
              <div className="flex flex-col items-center justify-center h-72 text-zinc-400 gap-3">
                <Sparkles className="w-8 h-8 text-[var(--app-accent)] animate-spin" />
                <span className="text-sm font-bold text-white">
                  Buscando nos catálogos oficiais e addons...
                </span>
                <span className="text-xs text-zinc-500">
                  Localizando filmes e séries correspondentes
                </span>
              </div>
            ) : displayedItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-72 text-center p-8 bg-white/5 border border-white/10 rounded-2xl">
                <Search className="w-10 h-10 text-zinc-500 mb-3" />
                <h3 className="text-base font-bold text-white mb-1">
                  Nenhum título encontrado para "{query}"
                </h3>
                <p className="text-xs text-zinc-400 max-w-sm mb-4">
                  Tente digitar termos alternativos ou altere o filtro para "Todos"
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setFilterType('all');
                    setQuery('');
                    setFocusZone('keyboard');
                  }}
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-all"
                >
                  Limpar Busca e Ver Populares
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pb-6">
                {displayedItems.map((item, idx) => {
                  const isFocused = focusZone === 'results' && resultsIndex === idx;

                  return (
                    <div
                      key={`${item.id}-${idx}`}
                      ref={(el) => {
                        resultCardsRef.current[idx] = el;
                      }}
                      className="flex justify-center"
                    >
                      <MediaCard
                        item={item}
                        isFocused={isFocused}
                        onClick={() => {
                          setResultsIndex(idx);
                          setFocusZone('results');
                          onSelectItem(item);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>

      {/* ========================================================= */}
      {/* 3. FOOTER CONTROLLER SHORTCUTS                            */}
      {/* ========================================================= */}
      <footer className="px-10 py-3.5 border-t border-white/10 flex flex-wrap gap-3 items-center justify-between text-xs text-zinc-400 app-header-bar flex-shrink-0">
        <div className="flex flex-wrap items-center gap-5">
          {focusZone === 'keyboard' ? (
            <>
              <div className="liquid-glass-detail flex items-center gap-1.5">
            <LiquidGlassLayer />
                <ControllerButtonBadge button="A" size="sm" />
                <span className="font-bold text-zinc-200">{inputType === 'keyboard' ? 'Ver resultados' : 'Digitar caractere'}</span>
              </div>
              <div className="liquid-glass-detail flex items-center gap-1.5">
            <LiquidGlassLayer />
                <ControllerButtonBadge button="X" keyboardLabel="Backspace" size="sm" />
                <span className="font-bold text-zinc-200">Apagar (⌫)</span>
              </div>
              <div className="liquid-glass-detail flex items-center gap-1.5">
            <LiquidGlassLayer />
                <ControllerButtonBadge button="Y" keyboardLabel="Espaço" size="sm" />
                <span className="font-bold text-zinc-200">Espaço (␣)</span>
              </div>
              <div className="liquid-glass-detail flex items-center gap-1.5">
            <LiquidGlassLayer />
                <ControllerButtonBadge button="RT" keyboardLabel="Tab" size="sm" />
                <span className="font-bold text-zinc-200">Ir aos Resultados</span>
              </div>
            </>
          ) : (
            <>
              <div className="liquid-glass-detail flex items-center gap-1.5">
            <LiquidGlassLayer />
                <ControllerButtonBadge button="A" size="sm" />
                <span className="font-bold text-zinc-200">Ver Detalhes & Fontes</span>
              </div>
            </>
          )}

          <div className="liquid-glass-detail flex items-center gap-1.5">
            <LiquidGlassLayer />
            <ControllerButtonBadge button="B" size="sm" />
            <span className="font-bold text-zinc-200">
              {focusZone === 'results' ? 'Voltar ao teclado' : 'Fechar'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-zinc-500 font-medium text-[11px]">
          <span>{inputType === 'keyboard' ? 'Digite para buscar; setas para navegar' : 'D-Pad / analógico para navegar'}</span>
          <span>•</span>
          <span>{inputType === 'keyboard' ? 'Delete limpa a busca; Tab alterna o foco' : 'Touchpad exclusivo para digitação'}</span>
        </div>
      </footer>
    </div>
  );
};
