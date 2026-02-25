import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';

interface NavigationState {
  searchTerm: string;
  expandedCategories: string[];
  scrollPositions: Record<string, number>;
  lastViewedJobId: string | null;
  minimalView: boolean;
  /** Inventory list search (view-scoped). */
  inventorySearchTerm: string;
  /** Parts list search (view-scoped so it does not overwrite other views). */
  partsSearchTerm: string;
}

const defaultState: NavigationState = {
  searchTerm: '',
  expandedCategories: [],
  scrollPositions: {},
  lastViewedJobId: null,
  minimalView: false,
  inventorySearchTerm: '',
  partsSearchTerm: '',
};

const NavigationContext = createContext<{
  state: NavigationState;
  updateState: (newState: Partial<NavigationState>) => void;
  resetState: () => void;
}>({
  state: defaultState,
  updateState: () => {},
  resetState: () => {},
});

export const NavigationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setState] = useState<NavigationState>(() => {
    try {
      const saved = localStorage.getItem('navigationState');
      if (!saved) return defaultState;
      const parsed = JSON.parse(saved) as Partial<NavigationState>;
      return { ...defaultState, ...parsed };
    } catch {
      return defaultState;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('navigationState', JSON.stringify(state));
    } catch (error) {
      console.error('Failed to save navigation state:', error);
    }
  }, [state]);

  const updateState = useCallback((newState: Partial<NavigationState>) => {
    setState((prev) => ({ ...prev, ...newState }));
  }, []);

  const resetState = useCallback(() => {
    setState(defaultState);
    try {
      localStorage.removeItem('navigationState');
    } catch (error) {
      console.error('Failed to reset navigation state:', error);
    }
  }, []);

  return (
    <NavigationContext.Provider value={{ state, updateState, resetState }}>
      {children}
    </NavigationContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- hook is the primary API
export const useNavigation = () => useContext(NavigationContext);
