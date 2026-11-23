import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  it('renders the title', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne('/api/health').flush({ status: 'ok', llm_configured: false, snowflake_configured: false });
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Data Engineering Copilot');
  });

  it('keeps Run disabled until SQL is validated and Snowflake is configured', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne('/api/health').flush({ status: 'ok', llm_configured: true, snowflake_configured: true });
    fixture.componentInstance.onSqlEdit('select 1');
    fixture.detectChanges();
    const run = [...fixture.nativeElement.querySelectorAll('button')].find((b: HTMLButtonElement) => b.textContent?.trim() === 'Run');
    expect(run.disabled).toBeTrue();
  });

  it('sends a chat message and shows the agent answer', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne('/api/health').flush({ status: 'ok', llm_configured: false, snowflake_configured: false });
    fixture.componentInstance.send('explain fct_orders');
    http.expectOne('/api/chat').flush({ intent: 'dbt', agent: 'dbt', answer: 'fct_orders is incremental', status: 'succeeded' });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('fct_orders is incremental');
  });
});
