// Registre partagé des positions d'éléments à mettre en avant pendant le tour guidé.
// Chaque élément ciblé (dans n'importe quel écran) s'enregistre via useTourTarget(id) ;
// l'overlay (TourOverlay) lit ces positions pour savoir où découper le voile et poser la bulle.
import { createContext, useCallback, useContext, useRef } from "react";
import { View } from "react-native";

export type TourRect = { x: number; y: number; width: number; height: number };

type TourCtxValue = {
  register: (id: string, rect: TourRect) => void;
  getRect: (id: string) => TourRect | undefined;
  subscribe: (cb: () => void) => () => void;
};

const TourContext = createContext<TourCtxValue | null>(null);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const rects = useRef<Record<string, TourRect>>({});
  const listeners = useRef<Set<() => void>>(new Set());

  const register = useCallback((id: string, rect: TourRect) => {
    rects.current[id] = rect;
    listeners.current.forEach((cb) => cb());
  }, []);
  const getRect = useCallback((id: string) => rects.current[id], []);
  const subscribe = useCallback((cb: () => void) => {
    listeners.current.add(cb);
    return () => { listeners.current.delete(cb); };
  }, []);

  return <TourContext.Provider value={{ register, getRect, subscribe }}>{children}</TourContext.Provider>;
}

// À poser sur l'élément à cibler : ref={target.ref} onLayout={target.onLayout}
export function useTourTarget(id: string) {
  const ctx = useContext(TourContext);
  const viewRef = useRef<View>(null);

  const onLayout = useCallback(() => {
    if (!ctx || !viewRef.current) return;
    // measureInWindow doit être appelé après que la mise en page soit bien posée.
    requestAnimationFrame(() => {
      viewRef.current?.measureInWindow((x, y, width, height) => {
        ctx.register(id, { x, y, width, height });
      });
    });
  }, [ctx, id]);

  return { ref: viewRef, onLayout };
}

export function useTourContext() {
  return useContext(TourContext);
}
