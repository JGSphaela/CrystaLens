import { defineConfig } from 'vite';

export default defineConfig({
  // Setting base to './' ensures that the built assets load correctly
  // using relative paths. This means it will work perfectly whether 
  // deployed to a root domain (username.github.io) or a subdirectory 
  // (username.github.io/repo-name).
  base: './',
});
