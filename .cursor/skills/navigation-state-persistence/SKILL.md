---
name: navigation-state-persistence
description: Owns remembered UI state in WorkTrack Pro. Always uses NavigationContext to persist search/filter/scroll/expanded/minimal-view/last-job/active-tab. Ensures back/refresh feel native. Use when implementing navigation, state persistence, scroll restoration, or UI state management.
---

# Navigation & State Persistence Expert

## Core Responsibility

**Always use NavigationContext** for any UI state that should survive page refresh or browser back button. Never use component-local state for persistent UI preferences.

---

## NavigationContext Pattern

### Import & Usage

```typescript
import { useNavigation } from '@/contexts/NavigationContext';

const Component = () => {
  const { state, updateState, resetState } = useNavigation();
  
  // Access persisted state
  const searchTerm = state.searchTerm;
  const expandedCategories = state.expandedCategories;
  const scrollPosition = state.scrollPositions['inventory-view'];
  
  // Update state (automatically persists to localStorage)
  updateState({ searchTerm: 'new search' });
  updateState({ expandedCategories: [...state.expandedCategories, 'material'] });
  updateState({ scrollPositions: { ...state.scrollPositions, 'inventory-view': 500 } });
};
```

### Available State Fields

```typescript
interface NavigationState {
  searchTerm: string;                    // Current search query
  filters: string[];                     // Active filter IDs
  expandedCategories: string[];          // Expanded accordion/category IDs
  scrollPositions: Record<string, number>; // Scroll position by view key
  lastViewedJobId: string | null;        // Last job detail viewed
  minimalView: boolean;                  // Minimal/collapsed view toggle
  activeTab: string;                     // Active tab (e.g., 'details', 'comments', 'inventory')
}
```

---

## What to Persist

### ✅ Always Persist

- **Search terms**: User's current search query
- **Active filters**: Selected filter checkboxes/buttons
- **Expanded accordions**: Which categories/sections are open
- **Scroll positions**: Keyed by view identifier (e.g., `'inventory-view'`, `'jobs-list'`)
- **Last viewed job ID**: For returning to job detail after navigation
- **Minimal view toggle**: Collapsed/expanded view preference
- **Active tab**: Current tab in detail views

### ❌ Never Persist

- Form input values (use component state)
- Temporary UI state (loading, hover, focus)
- Data fetched from API (use AppContext)
- User authentication (use AppContext)

---

## Scroll Position Restoration

### Pattern: Save on Scroll

```typescript
const viewKey = 'inventory-view'; // Unique identifier for this view

useEffect(() => {
  const container = scrollContainerRef.current;
  if (!container) return;
  
  // Restore scroll position
  const savedPosition = state.scrollPositions[viewKey];
  if (savedPosition) {
    container.scrollTop = savedPosition;
  }
  
  // Save on scroll
  const handleScroll = () => {
    updateState({
      scrollPositions: {
        ...state.scrollPositions,
        [viewKey]: container.scrollTop,
      },
    });
  };
  
  container.addEventListener('scroll', handleScroll);
  return () => container.removeEventListener('scroll', handleScroll);
}, [state.scrollPositions, updateState, viewKey]);
```

### View Keys Convention

Use descriptive, unique keys:
- `'jobs-list'` - Jobs list view
- `'inventory-view'` - Inventory kanban view
- `'job-detail-comments'` - Comments section in job detail
- `'job-detail-inventory'` - Inventory section in job detail

---

## Search Term Persistence

### Pattern: Search Input

```typescript
const { state, updateState } = useNavigation();

// Initialize from persisted state
const [searchTerm, setSearchTerm] = useState(state.searchTerm);

// Update both local and persisted state
const handleSearchChange = (value: string) => {
  setSearchTerm(value);
  updateState({ searchTerm: value });
};

// Clear search
const handleClearSearch = () => {
  setSearchTerm('');
  updateState({ searchTerm: '' });
};
```

---

## Expanded Categories/Accordions

### Pattern: Toggle Expansion

```typescript
const { state, updateState } = useNavigation();

const expandedCategories = useMemo(() => {
  return new Set(state.expandedCategories || []);
}, [state.expandedCategories]);

const toggleCategory = (categoryId: string) => {
  const newExpanded = expandedCategories.has(categoryId)
    ? state.expandedCategories.filter((id) => id !== categoryId)
    : [...state.expandedCategories, categoryId];
  updateState({ expandedCategories: newExpanded });
};

const expandAll = () => {
  updateState({ expandedCategories: ALL_CATEGORY_IDS });
};

const collapseAll = () => {
  updateState({ expandedCategories: [] });
};
```

---

## Active Tab Persistence

### Pattern: Tab Navigation

```typescript
const { state, updateState } = useNavigation();

// Initialize from persisted state
const [activeTab, setActiveTab] = useState(state.activeTab || 'details');

// Update both local and persisted state
const handleTabChange = (tab: string) => {
  setActiveTab(tab);
  updateState({ activeTab: tab });
};

// Use persisted tab on mount
useEffect(() => {
  if (state.activeTab) {
    setActiveTab(state.activeTab);
  }
}, [state.activeTab]);
```

---

## Last Viewed Job ID

### Pattern: Track Job Navigation

```typescript
const { state, updateState } = useNavigation();

// When navigating to job detail
const handleJobClick = (jobId: string) => {
  updateState({ lastViewedJobId: jobId });
  onNavigate('job-detail', jobId);
};

// Return to last viewed job
const returnToLastJob = () => {
  if (state.lastViewedJobId) {
    onNavigate('job-detail', state.lastViewedJobId);
  }
};
```

---

## Minimal View Toggle

### Pattern: View Preference

```typescript
const { state, updateState } = useNavigation();

const minimalView = state.minimalView || false;

const toggleMinimalView = () => {
  updateState({ minimalView: !minimalView });
};

// Use in rendering
{minimalView ? (
  <CompactView />
) : (
  <FullView />
)}
```

---

## React Router Integration

### Pattern: Back Navigation with State

```typescript
import { useLocation, useNavigate } from 'react-router-dom';

const location = useLocation();
const navigate = useNavigate();
const { state: navState, updateState } = useNavigation();

// Navigate forward, storing return path
const navigateToJob = (jobId: string) => {
  updateState({ lastViewedJobId: jobId });
  navigate(`/jobs/${jobId}`, {
    state: { returnView: 'jobs-list', returnTo: location.pathname },
  });
};

// Navigate back using stored return path
const navigateBack = () => {
  const returnTo = location.state?.returnTo;
  if (returnTo) {
    navigate(returnTo);
  } else {
    // Fallback to last viewed job or default view
    if (navState.lastViewedJobId) {
      navigate(`/jobs/${navState.lastViewedJobId}`);
    } else {
      navigate('/');
    }
  }
};
```

---

## Filter Persistence

### Pattern: Multi-Select Filters

```typescript
const { state, updateState } = useNavigation();

const activeFilters = state.filters || [];

const toggleFilter = (filterId: string) => {
  const newFilters = activeFilters.includes(filterId)
    ? activeFilters.filter((id) => id !== filterId)
    : [...activeFilters, filterId];
  updateState({ filters: newFilters });
};

const clearFilters = () => {
  updateState({ filters: [] });
};

// Apply filters to data
const filteredData = useMemo(() => {
  return data.filter((item) => {
    if (activeFilters.length === 0) return true;
    return activeFilters.some((filterId) => matchesFilter(item, filterId));
  });
}, [data, activeFilters]);
```

---

## Common Mistakes to Avoid

### ❌ Don't Use Component State for Persistent UI

```typescript
// BAD - Lost on refresh
const [searchTerm, setSearchTerm] = useState('');

// GOOD - Persists across refresh
const { state, updateState } = useNavigation();
const searchTerm = state.searchTerm;
```

### ❌ Don't Forget to Restore State on Mount

```typescript
// BAD - Doesn't restore
const [expanded, setExpanded] = useState(false);

// GOOD - Restores from NavigationContext
const { state } = useNavigation();
const expanded = state.expandedCategories.includes(categoryId);
```

### ❌ Don't Use Different Keys for Same View

```typescript
// BAD - Inconsistent keys
state.scrollPositions['inventory']
state.scrollPositions['inventory-view']
state.scrollPositions['inventoryKanban']

// GOOD - Consistent key
state.scrollPositions['inventory-view']
```

---

## Quick Reference Checklist

When implementing navigation or UI state:

- [ ] **Using NavigationContext?** Not component-local state
- [ ] **Search term persists?** Survives refresh
- [ ] **Filters persist?** Checkboxes/buttons remember selection
- [ ] **Scroll restored?** Position saved and restored on mount
- [ ] **Expanded state persists?** Accordions remember open/closed
- [ ] **Active tab persists?** Tab selection survives navigation
- [ ] **Last job tracked?** Can return to last viewed job
- [ ] **Back button works?** Uses location.state for return path
- [ ] **View keys consistent?** Same key used for same view
- [ ] **State cleared appropriately?** Reset when needed (e.g., logout)

---

## Integration with Other Contexts

### NavigationContext vs AppContext

- **NavigationContext**: UI state (search, filters, scroll, expanded, tabs)
- **AppContext**: Data state (jobs, inventory, users, shifts)

```typescript
// NavigationContext - UI preferences
const { state: navState } = useNavigation();
const searchTerm = navState.searchTerm;

// AppContext - Data
const { jobs, inventory } = useApp();
const filteredJobs = jobs.filter(job => 
  job.name.toLowerCase().includes(searchTerm.toLowerCase())
);
```

### NavigationContext vs React Router

- **NavigationContext**: Persists across refreshes (localStorage)
- **React Router location.state**: Temporary navigation state (lost on refresh)

```typescript
// NavigationContext - Persistent
updateState({ lastViewedJobId: jobId });

// React Router - Temporary
navigate('/jobs/123', { state: { returnTo: '/inventory' } });
```

---

## Examples from Codebase

### InventoryKanban: Expanded Categories

```typescript
const { state: navState, updateState } = useNavigation();

const expandedCategories = useMemo(() => {
  return new Set(navState.expandedCategories || []);
}, [navState.expandedCategories]);

const toggleCategory = (categoryId: string) => {
  const newExpanded = expandedCategories.has(categoryId)
    ? navState.expandedCategories.filter((id) => id !== categoryId)
    : [...navState.expandedCategories, categoryId];
  updateState({ expandedCategories: newExpanded });
};
```

### JobDetail: Active Tab

```typescript
const { state: navState, updateState } = useNavigation();
const [activeTab, setActiveTab] = useState(navState.activeTab || 'details');

const handleTabChange = (tab: string) => {
  setActiveTab(tab);
  updateState({ activeTab: tab });
};
```
