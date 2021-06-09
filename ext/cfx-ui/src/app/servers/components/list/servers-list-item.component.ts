import {
	Component, Input, ViewChild, ChangeDetectionStrategy,
	OnDestroy, OnInit, ElementRef, AfterViewInit, NgZone, Renderer2, OnChanges, ChangeDetectorRef
} from '@angular/core';
import { Router } from '@angular/router';

import { Server } from '../../server';

import { GameService } from '../../../game.service'
import { DiscourseService, BoostData } from 'app/discourse.service';

import * as hoverintent from 'hoverintent';
import { ServersService } from '../../servers.service';

import parseAPNG, { isNotAPNG } from '@citizenfx/apng-js';
import { ServerTagsService } from 'app/servers/server-tags.service';
import { Subscription } from 'rxjs';
import { environment } from 'environments/environment';

@Component({
	moduleId: module.id,
	selector: 'servers-list-item',
	templateUrl: 'servers-list-item.component.html',
	styleUrls: ['servers-list-item.component.scss'],
	changeDetection: ChangeDetectionStrategy.OnPush
})

export class ServersListItemComponent implements OnInit, OnChanges, OnDestroy, AfterViewInit {
	@Input()
	server: Server;

	@Input()
	pinned = false;

	@Input()
	isPinList = false;

	@ViewChild('iconFigure')
	iconFigure: ElementRef;

	private hoverIntent: any;

	private upvoting = false;

    private tagSubscription: Subscription;

	constructor(private gameService: GameService, private discourseService: DiscourseService, private tagService: ServerTagsService,
		private serversService: ServersService, private router: Router, private elementRef: ElementRef,
		private zone: NgZone, private renderer: Renderer2, private cdr: ChangeDetectorRef) {
    }

    get isWeb() {
        return environment.web;
    }

	get premium() {
		if (!this.server.data.vars) {
			return '';
		}

		return this.server.data.vars.premium;
	}

	public ngOnInit() {
		this.hoverIntent = hoverintent(this.elementRef.nativeElement, () => {
			this.serversService.getServer(this.server.address, true);
		}, () => { });

		this.hoverIntent.options({
			interval: 50
		});

        this.tagSubscription = this.tagService.onUpdate.subscribe(() => this.cdr.detectChanges());
	}

	public ngOnDestroy() {
		this.hoverIntent.remove();

        this.tagSubscription.unsubscribe();
	}

	public ngAfterViewInit() {
		this.initIcon();
	}

	public ngOnChanges(changes) {
		this.initIcon();
	}

	iconInsertionRAF;
	lastIconNode;

	private placeIconNode(node: HTMLImageElement) {
		this.iconInsertionRAF = requestAnimationFrame(() => {
			const figureElement = this.iconFigure.nativeElement as HTMLDivElement;

			if (this.lastIconNode) {
				this.renderer.removeChild(figureElement, this.lastIconNode);
			}

			this.renderer.appendChild(figureElement, node);

			this.lastIconNode = node;
		});
	}

	private initIcon() {
		if (this.iconInsertionRAF) {
			cancelAnimationFrame(this.iconInsertionRAF);
		}

		if (!this.iconFigure?.nativeElement) {
			return;
		}

		// APNG icons only allowed for pt level
		// So we have to check if other levels don't violate that
		if (this.premium !== 'pt') {
			if (this.server.iconNeedsResolving) {
				this.zone.runOutsideAngular(() => {
					this.resolveIcon();
				});
				return;
			}

			if (this.server.cachedResolvedIcon) {
				this.zone.runOutsideAngular(() => {
					this.placeIconNode(this.server.cachedResolvedIcon);
				});
			}
		}
	}

	private async resolveIcon() {
		try {
			const response = await fetch(this.server.iconUri);

			if (!response.ok) {
				throw new Error();
			}

			const buffer = await response.arrayBuffer();
			const png = parseAPNG(buffer);

			if (isNotAPNG(png)) {
				const imageElement = document.createElement('img');
				imageElement.src = this.server.iconUri;

				await imageElement.decode();

				this.server.cachedResolvedIcon = imageElement;
				this.placeIconNode(imageElement);
			} else {
				if (png instanceof Error) {
					throw png;
				}

				const frame = png.frames[0];
				await frame.createImage();

				const imageElement = frame.imageElement;
				await imageElement.decode();

				this.server.cachedResolvedIcon = imageElement;
				this.placeIconNode(imageElement);
			}
		} catch (e) {
			this.server.setDefaultIcon();
		} finally {
			this.server.iconNeedsResolving = false;
		}
	}

	attemptConnect(event: Event) {
		this.gameService.connectTo(this.server);

		event.stopPropagation();
	}

	showServerDetail() {
		this.zone.run(() => {
			this.router.navigate(['/', 'servers', 'detail', this.server.address]);
		});
	}

	isFavorite() {
		return this.gameService.isMatchingServer('favorites', this.server);
	}

	toggleFavorite(event: Event) {
		if (this.isFavorite()) {
			this.removeFavorite();
		} else {
			this.addFavorite();
		}

		event.stopPropagation();
	}

	addFavorite() {
		this.gameService.toggleListEntry('favorites', this.server, true);
	}

	removeFavorite() {
		this.gameService.toggleListEntry('favorites', this.server, false);
	}

	enableBoost(event: Event) {
        if (!environment.web) {
		    this.addBoost();
        }

		event.stopPropagation();
	}

	isBoost() {
		return this.discourseService.currentBoost && this.discourseService.currentBoost.address === this.server.address;
	}

	addBoost() {
		if (!this.discourseService.currentUser) {
			this.gameService.invokeInformational(
				'You need to have a linked FiveM account in order to BOOST™ a server.'
			);

			return;
		}

		if (this.upvoting) {
			return;
		}

		this.discourseService.externalCall('https://servers-frontend.fivem.net/api/upvote/', 'POST', {
			address: this.server.address
		}).then((response) => {
			if (response.data.success) {
				if (!this.discourseService.currentBoost) {
					this.discourseService.currentBoost = new BoostData();
				}

				this.discourseService.currentBoost.address = this.server.address;
				this.discourseService.currentBoost.server = this.server;

				this.gameService.invokeInformational(
					`Your BOOST™ is now assigned to this server (with an admirable strength of ${response.data.power})! `
					+ 'Thanks for helping the server go higher.'
				);
			} else if (response.data.error) {
				this.gameService.invokeError(
					response.data.error
				);
			} else {
				this.gameService.invokeError(
					':( Assigning BOOST™ failed. Please try again later, or contact FiveM support if this issue persists!'
				);
			}

			this.upvoting = false;
		}).catch(_=>_);
	}

	get locale() {
		return this.server?.data?.vars?.locale ?? 'root-001';
	}

	get localeCountry() {
		const parts = this.locale.split('-');
		return parts[parts.length - 1].toLowerCase();
	}

	get localeName() {
		return this.tagService.getLocaleDisplayName(this.locale);
	}

	get tags() {
		const tagList = Array.from(new Set<string>(((this.server.data?.vars?.tags as string) ?? '').split(',').map(a => a.trim())));
		const tagsByCount = tagList
			.map(a => this.tagService.coreTags[a]).filter(a => a).sort((a, b) => (b.count - a.count))
			.filter(a => a.count >= 8);

		if (tagsByCount.length > 4) {
			tagsByCount.length = 4;
		}

		return tagsByCount.map(a => a.name);
	}
}
