import { Link, createBrowserRouter } from 'react-router'

import { AppShell } from '@/components/layout/app-shell'
import { EmptyState } from '@/components/empty-state'
import { Button } from '@/components/ui/button'
import { AccessPage } from '@/routes/access'
import { AuditPage } from '@/routes/audit'
import { AuthCallbackPage } from '@/routes/auth-callback'
import { ClusterDetailPage } from '@/routes/cluster-detail'
import { ClusterNewPage } from '@/routes/cluster-new'
import { ClustersPage } from '@/routes/clusters'
import { EnvironmentsPage } from '@/routes/environments'
import { ImagesPage } from '@/routes/images'
import { JobNewPage } from '@/routes/job-new'
import { JobsPage } from '@/routes/jobs'
import { LoginPage } from '@/routes/login'
import { OverviewPage } from '@/routes/overview'
import { PoolDetailPage } from '@/routes/pool-detail'
import { PoolNewPage } from '@/routes/pool-new'
import { PoolsPage } from '@/routes/pools'
import { RegistryPage } from '@/routes/registry'
import { ServiceDetailPage } from '@/routes/service-detail'
import { ServiceNewPage } from '@/routes/service-new'
import { ServicesPage } from '@/routes/services'
import { SettingsPage } from '@/routes/settings'
import { UsagePage } from '@/routes/usage'

function NotFoundPage() {
  return (
    <EmptyState
      title="Page not found"
      description="That route doesn't exist in the Bifrost console."
      action={
        <Button asChild size="sm" variant="outline">
          <Link to="/">Back to overview</Link>
        </Button>
      }
    />
  )
}

/** Information architecture from spec §4. */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: '/', element: <OverviewPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/auth/callback', element: <AuthCallbackPage /> },
      { path: '/clusters', element: <ClustersPage /> },
      { path: '/clusters/new', element: <ClusterNewPage /> },
      { path: '/clusters/:clusterId', element: <ClusterDetailPage /> },
      { path: '/services', element: <ServicesPage /> },
      { path: '/services/new', element: <ServiceNewPage /> },
      { path: '/services/:name', element: <ServiceDetailPage /> },
      { path: '/pools', element: <PoolsPage /> },
      { path: '/pools/new', element: <PoolNewPage /> },
      { path: '/pools/:name', element: <PoolDetailPage /> },
      { path: '/usage', element: <UsagePage /> },
      { path: '/jobs', element: <JobsPage /> },
      { path: '/jobs/new', element: <JobNewPage /> },
      { path: '/environments', element: <EnvironmentsPage /> },
      { path: '/images', element: <ImagesPage /> },
      { path: '/registry', element: <RegistryPage /> },
      { path: '/audit', element: <AuditPage /> },
      { path: '/access', element: <AccessPage /> },
      { path: '/settings', element: <SettingsPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
