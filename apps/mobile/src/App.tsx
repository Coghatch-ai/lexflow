import type { ReactElement } from "react";
import { Route, Switch } from "wouter";
import { SignedIn, SignedOut, SignInPage } from "./auth";
import { MobileLayout } from "./components/MobileLayout";
import { PracticeStateProvider } from "./state/practice-state";
import { HomePage } from "./pages/HomePage";
import { PracticePage } from "./pages/PracticePage";
import { ResultPage } from "./pages/ResultPage";

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
              <Route path="/result">
                <ResultPage />
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
