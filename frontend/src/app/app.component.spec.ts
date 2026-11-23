import { TestBed, fakeAsync, tick } from '@angular/core/testing';
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

  it('sends a chat message, types the answer and shows the agent trace', fakeAsync(() => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne('/api/health').flush({ status: 'ok', llm_configured: false, snowflake_configured: false });
    fixture.componentInstance.send('explain fct_orders');
    http.expectOne('/api/chat').flush({ intent: 'dbt', agent: 'dbt', answer: 'fct_orders is incremental', status: 'succeeded' });
    tick(1000);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('fct_orders is incremental');
    expect(el.querySelector('.trace')?.textContent).toContain('Router');
    fixture.destroy();
  }));

  it('shows a bar chart for query results', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    http.expectOne('/api/health').flush({ status: 'ok', llm_configured: false, snowflake_configured: true });
    fixture.componentInstance.result.set({ status: 'succeeded', sql: '', columns: ['COUNTRY', 'REVENUE'],
      rows: [{ COUNTRY: 'India', REVENUE: 100 }, { COUNTRY: 'UAE', REVENUE: 50 }] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.bar').length).toBe(2);
  });
});
