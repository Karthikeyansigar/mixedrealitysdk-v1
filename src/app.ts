/*!
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import * as MRE from '@microsoft/mixed-reality-extension-sdk';
import { MreArgumentError } from '@microsoft/mixed-reality-extension-sdk';

/**
 * Solar system database
 */
interface Database {
	[key: string]: DatabaseRecord;
}

interface DatabaseRecord {
	name: string;
	fileFormat: string;
	parent: string;
	diameter: number;       // km
	modelpositionxAxis: number;
	modelpositionyAxis: number;
	modelpositionzAxis: number;	
	modelrotationxAxis: number;
	modelrotationyAxis: number;
	modelrotationzAxis: number;   
	labelpositionxAxis: number;
	labelpositionyAxis: number;
	labelpositionzAxis: number;	
	appearance: boolean;
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
	public labelLoopInc = 0;
	public gearLoopInc = 0;
	public animationLoopIterval: any;
	public childBoxTimeout: any;

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

		const positionValue = { x: facts.modelpositionxAxis, y: facts.modelpositionyAxis, z: facts.modelpositionzAxis };
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
						local: { position: { x: facts.labelpositionxAxis, 
							y: facts.labelpositionyAxis, 
							z: facts.labelpositionzAxis } }
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
			let prefab = this.assets.prefabs.find(p => p.source.uri === `assets/${bodyName}.`+facts.fileFormat);
			if (!prefab) {
				const modelData = await this.assets.loadGltf(`assets/${bodyName}.`+facts.fileFormat, "box");
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
							rotation : {x: facts.modelrotationxAxis, 
								y: facts.modelrotationyAxis, 
								z: facts.modelrotationzAxis}									 
						}
					},
					collider: {
						geometry: {
							shape: MRE.ColliderType.Sphere,
							radius: 0
						}
					}
				}
			});
			model.appearance.enabled = facts.appearance;
						
			const buttonBehavior = model.setBehavior(MRE.ButtonBehavior);
			
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

			if(facts.name !== ""){
				this.animationPlayPause(bodyName);
				buttonBehavior.onClick(() => {
					this.childModelDisplay();			
				});			
				
				buttonBehavior.onHover('enter', () => {
					this.boxAnimationEnter();								
				});			
				buttonBehavior.onHover('exit', () => {
					this.animationPlayPause(bodyName);
					this.boxAnimationExit();				
				});
			}


			if(bodyName === "only_gear"){				
				const AnimData: MRE.AnimationDataLike = { tracks: [{
					target: MRE.ActorPath("model").transform.local.rotation,
					relative: true,
					easing: MRE.AnimationEaseCurves.Linear,
					keyframes: [
						//{ time: 0.3, value: MRE.Quaternion.FromEulerAngles(0, 0, -Math.PI / 2) }
						{time: 0.3, value: MRE.Quaternion.FromEulerAngles(0, 0, 5) }
					]
				}]};

				this.assets = new MRE.AssetContainer(this.context);
				const animData = this.assets.createAnimationData('anim', AnimData);
				animData.bind({model}, { wrapMode: MRE.AnimationWrapMode.Loop, isPlaying: true });
				
			}
			

		} catch (e) {
			MRE.log.info('app', `createBody failed ${bodyName}, ${e}`);
		}
	}	

	private animationPlayPause(bodyName: string) {
		const celestialBody = this.celestialBodies[bodyName];
		this.animationLoopIterval = setInterval(() => {			
			if(this.labelLoopInc < 5) {
				celestialBody.label.transform.local.position.y = 
				celestialBody.label.transform.local.position.y + 0.01;
				this.labelLoopInc = this.labelLoopInc + 1;
				if(this.labelLoopInc === 5){
					this.labelLoopInc = 10;
				}
			}
			else{
				
				celestialBody.label.transform.local.position.y = 
				celestialBody.label.transform.local.position.y - 0.01;
				this.labelLoopInc = this.labelLoopInc - 1;
				if(this.labelLoopInc === 5){
					this.labelLoopInc = 0;
				}
			}				
		}, 100);
	}
	private boxAnimationEnter() {
		clearInterval(this.animationLoopIterval);
		const boxModel = this.celestialBodies["box_model_cloud"];
		const gearModel = this.celestialBodies["only_gear"];
		MRE.Animation.AnimateTo(this.context, boxModel.position, {	
			destination: { transform: { local: { position: { y: 0.1 } } } },
			duration: 1,
			easing: MRE.AnimationEaseCurves.EaseOutSine
		});	
		MRE.Animation.AnimateTo(this.context, gearModel.position, {
			destination: { transform: { local: { position: { y: 0.350 } } } },
			duration: 1,
			easing: MRE.AnimationEaseCurves.EaseOutSine
		});	
	}
	private boxAnimationExit() {
		const boxModel = this.celestialBodies["box_model_cloud"];
		const gearModel = this.celestialBodies["only_gear"];
		
		MRE.Animation.AnimateTo(this.context, boxModel.position, {
			destination: { transform: { local: { position: { y: 0} } } },
			duration: 1,
			easing: MRE.AnimationEaseCurves.EaseOutSine,
		});
		MRE.Animation.AnimateTo(this.context, gearModel.position, {
			destination: { transform: { local: { position: { y: 0.250} } } },
			duration: 1,
			easing: MRE.AnimationEaseCurves.EaseOutSine,
		});
		this.childBoxTimeout = setTimeout(() => {	
			//this.celestialBodies["popup_model"].model.appearance.enabled = false;	
			const scaleMultiplier = Math.pow(0, 1 / 3) / 25;		
			const scaleValue = { x: scaleMultiplier / 2, y: scaleMultiplier / 2, z: scaleMultiplier / 2 };
			MRE.Animation.AnimateTo(this.context, this.celestialBodies["popup_model"].model, {
				destination: { transform: { local: { scale: scaleValue } } },
				duration: 1,
				easing: MRE.AnimationEaseCurves.EaseOutSine,
			});
		},3000);
	}
	private gearAnimation(bodyName: string) {
		const celestialBody = this.celestialBodies[bodyName];
		setInterval(() => {			
			if(this.gearLoopInc < 10) {
				celestialBody.model.transform.local.rotation.x = 
				celestialBody.model.transform.local.rotation.x + 0.01;
				this.gearLoopInc = this.gearLoopInc + 1;
				if(this.gearLoopInc === 10){
					this.gearLoopInc = 20;
				}
			}
			else{
				
				celestialBody.model.transform.local.rotation.x = 
				celestialBody.model.transform.local.rotation.x - 0.01;
				this.gearLoopInc = this.gearLoopInc - 1;
				if(this.gearLoopInc === 10){
					this.gearLoopInc = 0;
				}
			}				
		}, 100);
	}
	private childModelDisplay() {
		clearTimeout(this.childBoxTimeout);
		const celestialBody = this.celestialBodies["popup_model"];	
		celestialBody.model.appearance.enabled = true;	
		const scaleMultiplier = Math.pow(1000, 1 / 3) / 25;		
		const scaleValue = { x: scaleMultiplier / 2, y: scaleMultiplier / 2, z: scaleMultiplier / 2 };
		MRE.Animation.AnimateTo(this.context, celestialBody.model, {
			destination: { transform: { local: { scale: scaleValue } } },
			duration: 1,
			easing: MRE.AnimationEaseCurves.EaseOutSine,
		});
			
	}
}
