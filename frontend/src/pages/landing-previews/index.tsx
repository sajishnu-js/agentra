import { Navigate, Route, Routes } from 'react-router-dom'

import { Var1VoidCathedral } from './Var1VoidCathedral'
import { Var2DiamondCore } from './Var2DiamondCore'
import { Var3PlasmaVortex } from './Var3PlasmaVortex'
import { Var4PrismHall } from './Var4PrismHall'

/** PREVIEW ONLY — see ./shared.tsx. Not linked from anywhere in the app. */
export function LandingPreviews() {
  return (
    <Routes>
      <Route index element={<Navigate to="/preview/1" replace />} />
      <Route path="1" element={<Var1VoidCathedral />} />
      <Route path="2" element={<Var2DiamondCore />} />
      <Route path="3" element={<Var3PlasmaVortex />} />
      <Route path="4" element={<Var4PrismHall />} />
      {/* Absolute, not relative — a relative target on a splat route appends
          forever (the bug fixed in Settings.tsx). */}
      <Route path="*" element={<Navigate to="/preview/1" replace />} />
    </Routes>
  )
}
