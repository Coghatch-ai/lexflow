import type { ReactElement } from "react";
import { Route, Switch } from "wouter";
import { SignedIn, SignedOut, SignInPage } from "./auth";
import { MobileLayout } from "./components/MobileLayout";
import { PracticeStateProvider } from "./state/practice-state";
import { HomePage } from "./pages/HomePage";
import { PracticePage } from "./pages/PracticePage";
import { ReviewPage } from "./pages/ReviewPage";
import { ResultPage } from "./pages/ResultPage";
import { ProgressPage } from "./pages/ProgressPage";
import { SavedPage } from "./pages/SavedPage";
import { GoalsPage } from "./pages/GoalsPage";

export default function App(): ReactElement {
  return (
    <>
      <SignedOut>
        <SignInPage />
      </SignedOut>
      <SignedIn>
        <PracticeStateProvider>
          <MobileLayout>
            <Switch>
              <Route path="/">
                <HomePage />
              </Route>
              <Route path="/practice">
                <PracticePage />
              </Route>
              <Route path="/review">
                <ReviewPage />
              </Route>
              <Route path="/result">
                <ResultPage />
              </Route>
              <Route path="/progress">
                <ProgressPage />
              </Route>
              <Route path="/saved">
                <SavedPage />
              </Route>
              <Route path="/goals">
                <GoalsPage />
              </Route>
              <Route>
                <HomePage />
              </Route>
            </Switch>
          </MobileLayout>
        </PracticeStateProvider>
      </SignedIn>
    </>
  );
}
