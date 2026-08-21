import type { ReactElement } from "react";
import { Router, Switch, Route, Redirect } from "wouter";
import { SignedIn, SignedOut, SignInPage, SignUpPage, AUTH_ROUTES } from "@/auth";
import Layout from "./components/Layout";
import RunGuardProvider from "./components/RunGuardProvider";
import HomePage from "./pages/HomePage";
import TestingPage from "./pages/TestingPage";
import DiscursivePage from "./pages/DiscursivePage";
import AnalyticsPage from "./pages/AnalyticsPage";
import GoalsPage from "./pages/GoalsPage";
import ProfilePage from "./pages/ProfilePage";
import {
  AdminQuestionsPage,
  AdminAlgorithmPage,
  AdminCalendarPage,
  AdminCouponsPage,
} from "./pages/AdminPage";
import { AdminIssuesPage } from "./pages/AdminIssuesPage";
import SavedQuestionsPage from "./pages/SavedQuestionsPage";
import StudyPlanPage from "./pages/StudyPlanPage";
import BillingPage from "./pages/BillingPage";

export default function App(): ReactElement {
  return (
    <>
      <SignedOut>
        {/* Signed-out routing exists so the APP owns /sign-up. Clerk's footer link points here
            (AUTH_ROUTES.signUp) instead of at the hosted Account Portal, which cannot be themed
            from code. The catch-all Route MUST stay last: any unmatched path while signed out
            falls through to sign-in, so a deep link to a protected page still lands somewhere
            sensible rather than rendering blank. */}
        <Router>
          <Switch>
            <Route path={AUTH_ROUTES.signUp} component={SignUpPage} />
            <Route component={SignInPage} />
          </Switch>
        </Router>
      </SignedOut>
      <SignedIn>
        {/* RunGuardProvider sits INSIDE <Router> (it needs useLocation) and ABOVE
            <Layout> (the sidebar asks it before navigating, BR-05.1 / slice S1b). */}
        <Router>
          <RunGuardProvider>
            <Layout>
              <Switch>
                <Route path="/" component={HomePage} />
                <Route path="/testing" component={TestingPage} />
                <Route path="/discursive" component={DiscursivePage} />
                <Route path="/analytics" component={AnalyticsPage} />
                <Route path="/goals" component={GoalsPage} />
                <Route path="/study-plans" component={StudyPlanPage} />
                <Route path="/profile" component={ProfilePage} />
                <Route path="/saved" component={SavedQuestionsPage} />
                <Route path="/admin/questions" component={AdminQuestionsPage} />
                <Route path="/admin/algorithm" component={AdminAlgorithmPage} />
                <Route path="/admin/calendar" component={AdminCalendarPage} />
                <Route path="/admin/coupons" component={AdminCouponsPage} />
                <Route path="/admin/issues" component={AdminIssuesPage} />
                <Route path="/billing" component={BillingPage} />
                <Route>
                  <Redirect to="/" />
                </Route>
              </Switch>
            </Layout>
          </RunGuardProvider>
        </Router>
      </SignedIn>
    </>
  );
}
