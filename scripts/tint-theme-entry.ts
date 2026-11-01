import { refreshTransSurfaces, watchTransSurfaces } from '../src/utils/dom';

watchTransSurfaces();
(window as unknown as { __ibtRefresh: () => void }).__ibtRefresh = refreshTransSurfaces;
