/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import * as MRE from '@microsoft/mixed-reality-extension-sdk';

/**
 * Solar system database
 */
interface Database {
	[key: string]: DatabaseRecord;
}

interface DatabaseRecord {
	name: string;
	parent: string;
	diameter: number;       // km
	distance: number;       // 10^6 km
	day: number;            // hours
	year: number;           // days
	inclination: number;    // degrees
	obliquity: number;      // degrees
	retrograde: boolean;
}

interface CelestialBody {
	inclination: MRE.Actor;
	position: MRE.Actor;
	obliquity0: MRE.Actor;
	obliquity1: MRE.Actor;
	model: MRE.Actor;
	label: MRE.Actor;
}

interface CelestialBodySet {
	[key: string]: CelestialBody;
}

// Data source: https://nssdc.gsfc.nasa.gov/planetary/dataheet/
// (some settings modified for scale and dramatic effect)
/* eslint-disable-next-line @typescript-eslint/no-var-requires */
const database: Database = require('../public/database.json');

/**
 * Solar System Application
 */
export default class SolarSystem {
	private celestialBodies: CelestialBodySet = {};
	private animationsRunning = false;
	private assets: MRE.AssetContainer;
	public loopInc = 0;
	public animationLoopIterval: any;

	constructor(private context: MRE.Context) {
		this.assets = new MRE.AssetContainer(context);
		this.context.onStarted(() => this.started());
	}

	private started() {
		// Check whether code is running in a debuggable watched filesystem
		// environment and if so delay starting the app by 1 second to give
		// the debugger time to detect that the server has restarted and reconnect.
		// The delay value below is in milliseconds so 1000 is a one second delay.
		// You may need to increase the delay or be able to decrease it depending
		// on the speed of your PC.
		const delay = 1000;
		const argv = process.execArgv.join();
		const isDebug = argv.includes('inspect') || argv.includes('debug');

		// version to use with non-async code
		if (isDebug) {
			setTimeout(this.startedImpl, delay);
		} else {
			this.startedImpl();
		}

		// // version to use with async code
		// if (isDebug) {
		// 	await new Promise(resolve => setTimeout(resolve, delay));
		// 	await this.startedImpl();
		// } else {
		// 	await this.startedImpl();
		// }
	}

	// use () => {} syntax here to get proper scope binding when called via setTimeout()
	// if async is required, next line becomes private startedImpl = async () => {
	private startedImpl = () => {
		this.createSolarSystem();

	}

	private createSolarSystem() {
		const keys = Object.keys(database);
		for (const bodyName of keys) {
			this.createBody(bodyName);
		}
	}

	// this function is "async", meaning that it returns a promise
	// (even though we don't use that promise in this sample).
	private async createBody(bodyName: string) {

		const facts = database[bodyName];

		const scaleMultiplier = Math.pow(facts.diameter, 1 / 3) / 25;

		const positionValue = { x: 0, y: 0, z: 0 };
		const scaleValue = { x: scaleMultiplier / 2, y: scaleMultiplier / 2, z: scaleMultiplier / 2 };
		const obliquityValue = MRE.Quaternion.RotationAxis(
			MRE.Vector3.Forward(), facts.obliquity * MRE.DegreesToRadians);
		const inclinationValue = MRE.Quaternion.RotationAxis(
			MRE.Vector3.Forward(), facts.inclination * MRE.DegreesToRadians);

		// Object layout for celestial body is:
		//  inclination                 -- orbital plane. centered on sol and tilted
		//      position                -- position of center of celestial body (orbits sol)
		//          label               -- centered above position. location of label.
		//          obliquity0          -- centered on position. hidden node to account
		//                                 for the fact that obliquity is a world-relative axis
		//              obliquity1      -- centered on position. tilt of obliquity axis
		//                  model       -- centered on position. the celestial body (rotates)
		try {
			const inclination = MRE.Actor.Create(this.context, {
				actor: {
					name: `${bodyName}-inclination`,
					transform: {
						app: { rotation: inclinationValue }
					}
				}
			});

			

			const position = MRE.Actor.Create(this.context, {
				actor: {
					name: `${bodyName}-position`,
					parentId: inclination.id,
					transform: {
						local: { position: positionValue }
					}
				}
			});
			const label = MRE.Actor.Create(this.context, {
				actor: {
					name: `${bodyName}-label`,
					parentId: position.id,
					transform: {
						local: { position: { x: 0, y: 0.4, z: 0 } }
					}
				}
			});
			const obliquity0 = MRE.Actor.Create(this.context, {
				actor: {
					name: `${bodyName}-obliquity0`,
					parentId: position.id
				}
			});
			const obliquity1 = MRE.Actor.Create(this.context, {
				actor: {
					name: `${bodyName}-obliquity1`,
					parentId: obliquity0.id,
					transform: {
						local: { rotation: obliquityValue }
					}
				}
			});

			// load the model if it hasn't been already
			let prefab = this.assets.prefabs.find(p => p.source.uri === `assets/${bodyName}.glb`);
			if (!prefab) {
				const modelData = await this.assets.loadGltf(`assets/${bodyName}.glb`, "box");
				prefab = modelData.find(a => a.prefab !== null).prefab;
			}

			const model = MRE.Actor.CreateFromPrefab(this.context, {
				prefab: prefab,
				actor: {
					name: `${bodyName}-body`,
					parentId: obliquity1.id,
					transform: {
						local: { 
							scale: scaleValue,									 
						}
					},
					collider: {
						geometry: {
							shape: MRE.ColliderType.Sphere,
							radius: 0.5
						}
					}
				}
			});
			
			
			const buttonBehavior = model.setBehavior(MRE.ButtonBehavior);
			
			buttonBehavior.onHover('enter', () => {
				clearInterval(this.animationLoopIterval);
				//model.transform.local.scale.y = modelOriginalHeight + 5;
				MRE.Animation.AnimateTo(this.context, position, {
					destination: { transform: { local: { position: { y: 0.05 } } } },
					duration: 1,
					easing: MRE.AnimationEaseCurves.EaseOutSine
				});								
			});

			
			buttonBehavior.onHover('exit', () => {
				this.animationPlayPause(bodyName);
				//model.transform.local.scale.y = modelOriginalHeight;
				MRE.Animation.AnimateTo(this.context, position, {
					destination: { transform: { local: { position: { y: 0} } } },
					duration: 1,
					easing: MRE.AnimationEaseCurves.EaseOutSine
				});
				
			});

			label.enableText({
				contents: facts.name,
				height: 0.05,
				pixelsPerLine: 20,
				color: MRE.Color3.White(),
				anchor: MRE.TextAnchorLocation.TopCenter,
				justify: MRE.TextJustify.Center,
			});
					
			

			this.celestialBodies[bodyName] = {
				inclination,
				position,
				obliquity0,
				obliquity1,
				model,
				label
			} as CelestialBody;	
			
			this.animationPlayPause(bodyName);

		} catch (e) {
			MRE.log.info('app', `createBody failed ${bodyName}, ${e}`);
		}
	}	

	private animationPlayPause(bodyName: string) {
		const celestialBody = this.celestialBodies[bodyName];
		this.animationLoopIterval = setInterval(() => {			
			if(this.loopInc < 5) {
				celestialBody.label.transform.local.position.y = celestialBody.label.transform.local.position.y + 0.01;
				this.loopInc = this.loopInc + 1;
				if(this.loopInc === 5){
					this.loopInc = 10;
				}
			}
			else{
				
				celestialBody.label.transform.local.position.y = celestialBody.label.transform.local.position.y - 0.01;
				this.loopInc = this.loopInc - 1;
				if(this.loopInc === 5){
					this.loopInc = 0;
				}
			}				
		}, 100);
	}
}
