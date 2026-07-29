import type { ReactElement } from "react";
import { Router, Switch, Route, Redirect } from "wouter";
import { SignedIn, SignedOut, SignInPage } from "@/auth";
import Layout from "./components/Layout";
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
        <SignInPage />
      </SignedOut>
      <SignedIn>
        <Router>
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
        </Router>
      </SignedIn>
    </>
  );
}
