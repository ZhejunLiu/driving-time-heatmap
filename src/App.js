import React, { Component } from 'react';
import request from 'superagent';
import Autocomplete from 'react-google-autocomplete';
import Geodesy from 'geodesy';

import './App.css';

class App extends Component {
  constructor(props) {
    super(props);
    this.state = {
      apiLoaded: false,
      loading: false,
      place: null,
      apiKey: window.localStorage.getItem('apiKey') || '',
      origin: {
        lat: null,
        lng: null
      },
      points: [],
      timeType: 'now', // valid values: 'arrival_time', 'departure_time', 'now'
      datetime: ''
    };
    this.handleApiKeyChange = this.handleApiKeyChange.bind(this);
    this.handleSubmit = this.handleSubmit.bind(this);
    this.handleLoad = this.handleLoad.bind(this);
    this.handlePlaceSelected = this.handlePlaceSelected.bind(this);
    this.handleDatetimeChange = this.handleDatetimeChange.bind(this);
    this.handleTimeTypeChange = this.handleTimeTypeChange.bind(this);
  }

  componentDidMount() {
    const mapsAPIScript = document.createElement('script');
    mapsAPIScript.src = `https://maps.googleapis.com/maps/api/js?key=${this.props.apiKey}&libraries=places`;
    document.body.appendChild(mapsAPIScript);
    mapsAPIScript.onload = () => this.setState({ apiLoaded: true });
  }

  handlePlaceSelected(place) {
    this.setState({ 
      origin: {
        lat: place.geometry.location.lat(),
        lng: place.geometry.location.lng()
      },
      points: []
    });
  }

  handleApiKeyChange(event) {
    this.setState({ apiKey: event.target.value }, () => {
      window.localStorage.setItem('apiKey', this.state.apiKey);
    });
  }

  handleSubmit(event) {
    event.preventDefault();
    if (!this.state.origin.lat) {
      return;
    }
    this.setState({ loading: true }, this.getTravelTimes);
  }

  handleLoad(event) {
    this.setState({ loading: false });
  }

  handleTimeTypeChange(event) {
    this.setState({ timeType: event.target.value });
  }

  handleDatetimeChange(event) {
    console.log(event.target.value);
    this.setState({ datetime: event.target.value });
  }

  displayOverlay() {
    return this.state.points.length && 
           this.state.points[0].hasOwnProperty('duration');
  }

  directionsFromNumPoints(numPoints) {
    const directions = [];
    for (let i = 0; i < numPoints; ++i) {
      directions.push((i / numPoints) * 360);
    }
    return directions;
  }

  query(points, acc) {
    if (!points.length) {
      return this.setState({ 
        points: this.state.points.map((p, i) => Object.assign({}, p, { duration: acc[i] }))
      });
    }
    const quantityPerCall = 24;
    const pointsFormatted = points
    .slice(0, quantityPerCall)
    .map(point => [point.lat, point.lon].join(','));
    return request
    .get('https://cors.harrisonliddiard.com/https://maps.googleapis.com/maps/api/distancematrix/json')
    .query({
      units: 'imperial',
      origins: [this.state.origin.lat, this.state.origin.lng].join(','),
      destinations: pointsFormatted.join('|'),
      key: this.state.apiKey,
      [this.state.timeType]: this.state.datetime ? Math.floor((new Date(this.state.datetime)).getTime() / 1000) : undefined
    })
    .then(res => {
      if (!res.body.rows.length || !res.body.rows[0].elements) {
        console.error(res.body);
        
        throw new Error('Malformed API response.');
      }
      const durations = res.body.rows[0].elements;
      const newAcc = durations
      .filter(d => d.duration_in_traffic || d.duration)
      .map(d => d.duration_in_traffic ? d.duration_in_traffic.value : d.duration.value);
      return this.query(points.slice(quantityPerCall), acc.concat(newAcc));
    });
  }

  getTravelTimes() {
    const LatLon = Geodesy.LatLonSpherical;
    const origin = LatLon(this.state.origin.lat, this.state.origin.lng);
    const ringRadii = new Array(this.props.rings.quantity)
    .fill(null)
    .map((_, index) => this.props.rings.radiusFunc(index));
    const ringPoints = ringRadii
    .map((radius, index) =>
      this.directionsFromNumPoints(this.props.rings.pointsFunc(index))
      .map(direction => 
        origin.destinationPoint(radius, direction)
      )
    );
    // https://stackoverflow.com/a/10865042
    this.setState({ points: [].concat.apply([], ringPoints) }, () => {
      this.query(this.state.points, []);
    });
  }

  render() {
    let map;
    if (this.state.origin.lat) {
      map = (
        <img className="map base" src={`https://maps.googleapis.com/maps/api/staticmap?center=${this.state.origin.lat},${this.state.origin.lng}&zoom=11&scale=2&size=640x640&maptype=roadmap&markers=${this.state.origin.lat},${this.state.origin.lng}`} alt="map" />
      );
    }
    let overlay, legend;
    if (this.displayOverlay()) {
      const paths = Object.keys(this.props.durations)
      .map(Number)
      .map((duration, i) =>
        `&markers=scale:3|icon:${this.props.iconUrlPrefix}${this.props.durations[duration]}.png|` + this.state.points
        .filter(p => {
          const minutesTo = p.duration / 60;
          if (i === 0) {
            return minutesTo <= duration;
          }
          else if (i === Object.keys(this.props.durations).length - 1) {
            return minutesTo > duration;
          }
          else {
            return minutesTo <= duration && minutesTo > duration - 5
          }
        })
        .map(p => [p.lat.toFixed(4), p.lon.toFixed(4)].join(','))
        .join('|')
      )
      .join('');
      const overlayStyles = '&style=visibility:off';
      overlay = (
        <img className="map overlay" onLoad={this.handleLoad} src={`https://maps.googleapis.com/maps/api/staticmap?center=${this.state.origin.lat},${this.state.origin.lng}${overlayStyles}&zoom=9&scale=2&size=640x640&maptype=roadmap${paths}`} alt="map" />
      );
      legend = (
        <legend>
          <h3>Minutes from start point</h3>
          <ul>
            { Object.keys(this.props.durations)
              .map((d, i) => {
                const color = this.props.durations[d];
                let range;
                if (i === 0)
                  range = `0–${d}`;
                else if (i === Object.keys(this.props.durations).length - 1)
                  range = `${d-5}+`;
                else
                  range = `${d-5}–${d}`;
                return <li> 
                  <img src={`${this.props.iconUrlPrefix}${color}.png`} alt={color} /> {range}
                </li>
              }) 
            }
          </ul>
        </legend>
      );
    }
    let submitText;
    if (this.state.loading) {
      submitText = <span>
        Generating Your Map… <span className="loading">{this.state.loading ? '↻' : ''}</span>
      </span>;
    }
    else {
      submitText = <span>4. Generate Your Map!</span>;
    }
    return (
      <div className="App">
        <header>
          <h1>Harrison’s Fabulous Driving Time Map™ 🚗 ⏱ 🗺</h1>
          <h2>See how much time it will take you to drive from a starting point – like your apartment or a prospective home – to surrounding areas in various traffic conditions.</h2>
          <form onSubmit={this.handleSubmit}>
            <h3>1. Enter a start address</h3>
            { this.state.apiLoaded ? 
              <Autocomplete
                style={{
                  width: '100%',
                  fontSize: '2em',
                  padding: '0.2em 0.4em'
                }}
                types={['address']}
                onPlaceSelected={this.handlePlaceSelected}
                placeholder="42 Wallaby Way, Sydney, Australia"
                required
                autoFocus
              /> : ''
            }
            <h3>2. Choose a date and time for traffic conditions</h3>
            <div className="time-type">
              <label>
                <input type="radio" value="now" onChange={this.handleTimeTypeChange}
                      checked={this.state.timeType === 'now'} />
                Now
              </label>
              <label>
                <input type="radio" value="departure_time" onChange={this.handleTimeTypeChange}
                      checked={this.state.timeType === 'departure_time'} />
                Depart at:
              </label>
              <label>
                <input type="radio" value="arrival_time" onChange={this.handleTimeTypeChange}
                      checked={this.state.timeType === 'arrival_time'} />
                Arrive by:
              </label>
              <input className="datetime" type="datetime-local"
                    value={this.state.datetime}
                    onChange={this.handleDatetimeChange} 
                    disabled={this.state.timeType === 'now'}
                    min={(new Date()).toISOString().substr(0, 16)} />
              {/* https://stackoverflow.com/a/26749559 ^ */}
              { this.state.timeType !== 'now' ? 
                <span className="tooltip">
                  Enter a date and time in the future; e.g. next Monday during rush hour.<br/>
                  Times are in your computer’s current time zone.
                </span>
                : ''
              }
            </div>
            <div className="api-key">
              <h3>3. Get and paste your map key</h3>
              <a href="#why-api-key" className="why">
                Why do I need to do this?
              </a>
              <p id="why-api-key">
                Generating the driving time map uses a Google Maps service that only allows a limited number of daily uses per person. Because of this, you need to get and use your own (free!) key. The key will allow you to generate about 20 driving time maps per day.
              </p>
              <ol>
                <li>Go to <a href="https://developers.google.com/maps/documentation/distance-matrix/get-api-key#step-1-get-an-api-key-from-the-google-api-console" target="_blank">this page</a> and press the “Get a key” button.</li>
                <li>From the “Select or create project” menu, select “Create a new project”.</li>
                <li>Name the project “Travel time map”.</li>
                <li>Press “Create and enable API”.</li>
                <li>Under “Your API key”, copy the string of letters and numbers and paste it below:</li>
              </ol>
              <input type="text" value={this.state.apiKey} 
                     onChange={this.handleApiKeyChange} 
                     required placeholder="Paste your key here" />
            </div>
            <button type="submit"
                    disabled={!this.state.apiKey || !this.state.origin.lat || this.state.loading}>
              {submitText}
            </button>
            { this.state.loading ? 
              <span className="loading-info">
                ⏳ Hang tight! This usually takes 10-15 seconds.
              </span> : ''
            }
          </form>
        </header>
        {legend}
        <figure className="map-wrapper">
          {overlay}
          {map}
        </figure>
      </div>
    );
  }
}

App.defaultProps = {
  apiKey: 'AIzaSyC4GIdBEWo_T_5-54ZqYWKM0P-CBWZH-ww',
  // must be HTTP, not HTTPS, for static maps api
  iconUrlPrefix: 'http://s3-us-west-2.amazonaws.com/travel-time.harrisonliddiard.com/',
  rings: {
    quantity: 8,
    radiusFunc: ringNum => (2400 * ringNum) + 2400,
    pointsFunc: ringNum => (3 * ringNum) + 4
  },
  durations: {
    // max 5 unique icons per request
    // https://developers.google.com/maps/documentation/static-maps/intro#CustomIcons
    10: 'teal',
    15: 'green',
    20: 'yellow',
    25: 'orange',
    30: 'red'
  }
};

export default App;
