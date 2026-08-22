import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// `globals: false`, so RTL's auto-cleanup never self-registers. Without this, renders
// accumulate across tests in a file and byRole queries hit duplicates.
afterEach(cleanup)
