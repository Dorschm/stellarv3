import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { FOOTER_AD_MIN_HEIGHT } from "./components/HomeFooterAd";

@customElement("gutter-ads")
export class GutterAds extends LitElement {
  @state()
  private isVisible: boolean = false; // Always false

  @state() private shouldShow: boolean = false; // Always false

  @state()
  private adLoaded: boolean = false;

  @state()
  private hasFooterAd: boolean = false;

  private onResize = () => {
    const isDesktop = window.innerWidth >= 640;
    this.hasFooterAd = isDesktop && window.innerHeight >= FOOTER_AD_MIN_HEIGHT;
  };

  private onUserMeResponse = () => {
    return; // Ads disabled
  };
  private leftAdType: string = "standard_iab_left2";
  private rightAdType: string = "standard_iab_rght1";
  private leftContainerId: string = "gutter-ad-container-left";
  private rightContainerId: string = "gutter-ad-container-right";

  // Override createRenderRoot to disable shadow DOM
  createRenderRoot() {
    return this;
  }

  static styles = css``;

  connectedCallback() {
    super.connectedCallback();
    this.onResize();
    window.addEventListener("resize", this.onResize);
    document.addEventListener("userMeResponse", () => {
      // Ads disabled
      console.log("not showing gutter ads");
    });
  }

  // Called after the component's DOM is first rendered
  firstUpdated() {
    // DOM is guaranteed to be available here
    console.log("GutterAdModal DOM is ready");
  }

  public show(): void {
    return; // Ads disabled
  }

  public close(): void {
    try {
      window.ramp.destroyUnits(this.leftAdType);
      window.ramp.destroyUnits(this.rightAdType);
      console.log("successfully destroyed gutter ads");
    } catch (e) {
      console.error("error destroying gutter ads", e);
    }
  }

  private loadAds(): void {
    // Ads disabled
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("resize", this.onResize);
  }

  render() {
    if (!this.isVisible) {
      return html``;
    }

    return html`
      <!-- Left Gutter Ad -->
      <div
        class="hidden xl:flex fixed transform -translate-y-1/2 w-[160px] min-h-[600px] z-40 pointer-events-auto items-center justify-center xl:[--half-content:10.5cm] 2xl:[--half-content:12.5cm]"
        style="left: calc(50% - var(--half-content) - 208px); top: calc(50% + 10px${this
          .hasFooterAd
          ? " - 1.2cm"
          : ""});"
      >
        <div
          id="${this.leftContainerId}"
          class="w-full h-full flex items-center justify-center p-2"
        ></div>
      </div>

      <!-- Right Gutter Ad -->
      <div
        class="hidden xl:flex fixed transform -translate-y-1/2 w-[160px] min-h-[600px] z-40 pointer-events-auto items-center justify-center xl:[--half-content:10.5cm] 2xl:[--half-content:12.5cm]"
        style="left: calc(50% + var(--half-content) + 48px); top: calc(50% + 10px${this
          .hasFooterAd
          ? " - 1.2cm"
          : ""});"
      >
        <div
          id="${this.rightContainerId}"
          class="w-full h-full flex items-center justify-center p-2"
        ></div>
      </div>
    `;
  }
}
