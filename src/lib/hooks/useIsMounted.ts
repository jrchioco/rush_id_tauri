import { useEffect, useRef } from "react";

export function useIsMounted(): () => boolean {
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  return () => mountedRef.current;
}
